<script lang="ts">
  import { page } from '$app/state';

  import Editor from '$lib/browse/Editor.svelte';
  import { parseConflicts } from '$lib/browse/conflict';
  import { logError } from '$lib/log';
  import { syncEngine } from '$lib/sync';
  import { vault, type NotePath } from '$lib/vault';

  const AUTOSAVE_DEBOUNCE_MS = 3000;

  // Active note path comes from the [...path] dynamic segment. Cast through
  // unknown because $app/state types `params` as Record<string, string> but
  // the runtime uses string | undefined for catch-all segments.
  const path = $derived.by((): NotePath | undefined => {
    const parameter: unknown = page.params.path;
    return typeof parameter === 'string' && parameter !== '' ? parameter : undefined;
  });

  let content = $state('');
  let loading = $state(true);
  let saveStatus = $state<'idle' | 'pending' | 'saved' | 'error'>('idle');
  let loadError = $state<string | undefined>(undefined);
  let notesList = $state<NotePath[]>([]);

  // Pending autosave bookkeeping. Hand-rolled rather than a debounce
  // package because we need to be able to flush() the pending save before
  // navigating away from a note. `pendingSave` always points at the most
  // recent unsaved (path, content) pair, regardless of which note is
  // currently displayed.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSave: { path: NotePath; content: string } | undefined;

  function scheduleSave(forPath: NotePath, next: string): void {
    pendingSave = { path: forPath, content: next };
    if (saveTimer !== undefined) {
      globalThis.clearTimeout(saveTimer);
    }
    saveTimer = globalThis.setTimeout(() => {
      saveTimer = undefined;
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function flushSave(): Promise<void> {
    if (saveTimer !== undefined) {
      globalThis.clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const job = pendingSave;
    if (job === undefined) return;
    pendingSave = undefined;
    try {
      await vault.writeNote(job.path, job.content);
      // Only update the visible status if we're still looking at this note —
      // otherwise a "saved" badge would flash for the new note.
      if (path === job.path) saveStatus = 'saved';
    } catch (error: unknown) {
      logError('browse-detail/save', { path: job.path, error });
      if (path === job.path) saveStatus = 'error';
    }
  }

  // Refresh the autocomplete list when the active note changes.
  $effect(() => {
    void path;
    void (async () => {
      try {
        notesList = await vault.listNotes();
      } catch (error: unknown) {
        logError('browse-detail/list', { error });
      }
    })();
  });

  // Load the note whenever the active path changes. If a save is pending for
  // a different note, flush it FIRST so the user's edits never go missing
  // when they switch notes within the autosave window.
  $effect(() => {
    const current = path;
    if (current === undefined) return;

    loading = true;
    loadError = undefined;
    saveStatus = 'idle';

    void (async () => {
      try {
        if (pendingSave !== undefined && pendingSave.path !== current) {
          await flushSave();
        }
        // Use readRaw so the editor displays the file verbatim (including
        // any YAML frontmatter block) rather than the body-only view.
        content = await vault.readRaw(current);
      } catch (error: unknown) {
        logError('browse-detail/read', { path: current, error });
        loadError = error instanceof Error ? error.message : String(error);
      } finally {
        loading = false;
      }
    })();
  });

  // Flush any pending save when the page unmounts (e.g. user navigates away
  // from /browse entirely).
  $effect(() => {
    return () => {
      void flushSave();
    };
  });

  // When the SyncEngine pulls in a HEAD-advancing change from the remote,
  // re-read the active note from disk so the editor reflects merged content.
  // We skip the reload if there's a pending unsaved edit AND we're not in
  // conflict — reading would clobber in-flight typing. In a conflict the
  // user's in-flight edit is what caused the conflict, so we re-read
  // anyway so they can see the markers.
  $effect(() => {
    return syncEngine.onRemoteChange(() => {
      const current = path;
      if (current === undefined) return;
      const inConflict = syncEngine.status.value.kind === 'conflict';
      if (!inConflict && pendingSave !== undefined) return;
      void reloadFromDisk(current, 'remote-change');
    });
  });

  // Backstop: if the engine flips to `conflict` status and the active
  // path is in the conflict list, re-read regardless. Covers the case
  // where the remote-change emit got missed (e.g. timing race) or the
  // conflict was discovered via a path other than the standard pull.
  $effect(() => {
    return syncEngine.subscribe((status) => {
      if (status.kind !== 'conflict') return;
      const current = path;
      if (current === undefined) return;
      if (!status.paths.includes(current)) return;
      void reloadFromDisk(current, 'conflict-status');
    });
  });

  async function reloadFromDisk(forPath: NotePath, reason: string): Promise<void> {
    try {
      const next = await vault.readRaw(forPath);
      const hasMarkers = /^<{7}/m.test(next);
      // Diagnostic: makes it observable in DevTools whether markers
      // actually landed on disk. If `hasMarkers: false` shows up here
      // when the engine reports conflict, the issue is in the merge
      // step, not in the editor refresh.
      console.warn('[open-brain/browse-detail/reload]', {
        path: forPath,
        reason,
        bytes: next.length,
        hasMarkers,
      });
      if (next !== content) content = next;
    } catch (error: unknown) {
      logError('browse-detail/reload-from-disk', { path: forPath, reason, error });
    }
  }

  // Phase 5.7: chats are read-only in Browse. The editor enforces the
  // attribute but the page also gates save scheduling — a re-render or future
  // refactor can't accidentally trigger a write.
  const isChat = $derived(path?.startsWith('.chats/') === true);
  // Phase 5.9: persona is editable but worth a heads-up about the
  // per-token cost. Other `.openbrain/*` files are bookkeeping and aren't
  // surfaced in Browse, so a single check on the persona path is enough.
  const isPersona = $derived(path === '.openbrain/persona.md');

  function handleChange(next: string): void {
    const current = path;
    if (current === undefined) return;
    if (isChat) return;
    content = next;
    saveStatus = 'pending';
    scheduleSave(current, next);
  }

  function getNotes(): readonly NotePath[] {
    return notesList;
  }

  // Count of unresolved conflict hunks in the current document. Drives the
  // header banner that explains the inline buttons. Re-derives whenever
  // `content` changes (which happens on load, on user edit, and on
  // remote-change pulls).
  const conflictCount = $derived(parseConflicts(content).length);

  // The user clicked "keep ours" or "keep theirs" on a conflict hunk in the
  // editor. Persist the resolved content immediately (skipping the 3s
  // autosave debounce — conflicts are urgent) and tell the SyncEngine the
  // file is no longer in conflict so it can re-enter the commit/push flow.
  function handleResolveConflict(next: string): void {
    const current = path;
    if (current === undefined) return;
    void (async () => {
      try {
        await vault.writeNote(current, next);
        syncEngine.markResolved(current);
        saveStatus = 'saved';
      } catch (error: unknown) {
        logError('browse-detail/resolve-conflict', { path: current, error });
        saveStatus = 'error';
      }
    })();
  }
</script>

<div class="detail">
  <header class="detail-header">
    <span class="path">{path ?? ''}</span>
    <span class="status" class:saved={saveStatus === 'saved'} class:error={saveStatus === 'error'}>
      {#if saveStatus === 'pending'}
        unsaved
      {:else if saveStatus === 'saved'}
        saved
      {:else if saveStatus === 'error'}
        save failed
      {/if}
    </span>
    <button
      type="button"
      class="reload-button"
      title="Re-read this note from disk (use after a sync to see the merged content)"
      onclick={() => {
        const current = path;
        if (current === undefined) return;
        void reloadFromDisk(current, 'manual');
      }}
      disabled={path === undefined}
    >
      reload
    </button>
  </header>

  {#if conflictCount > 0}
    <div class="conflict-banner" role="status" aria-live="polite">
      <strong>{conflictCount} merge conflict{conflictCount === 1 ? '' : 's'}</strong>
      in this note. Each block below shows your version and the version from another device — pick one
      to keep.
    </div>
  {/if}

  {#if isChat}
    <div class="chat-banner" role="status">
      <span>💬 read-only · chat session · open <a href="/chat">/chat</a> to continue</span>
    </div>
  {/if}

  {#if isPersona}
    <div class="persona-banner" role="status">
      <span>
        ⚙ persona · included in every chat turn · keep it short, every word counts against your
        model context
      </span>
    </div>
  {/if}

  {#if loading}
    <p class="empty">Loading…</p>
  {:else if loadError !== undefined}
    <p class="error-msg">{loadError}</p>
  {:else}
    <div class="editor-shell">
      <Editor
        value={content}
        onChange={handleChange}
        notes={getNotes}
        onResolveConflict={handleResolveConflict}
        onSave={() => void flushSave()}
        readOnly={isChat}
      />
    </div>
  {/if}
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .detail-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .path {
    flex: 1;
    opacity: 0.8;
  }

  .status {
    font-size: 0.7rem;
    opacity: 0.55;
  }

  .reload-button {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.7;
  }

  .reload-button:hover {
    opacity: 1;
  }

  .reload-button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .status.saved {
    color: var(--color-ok);
    opacity: 1;
  }

  .status.error {
    color: var(--color-danger);
    opacity: 1;
  }

  .conflict-banner {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.45;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-warn);
    background: color-mix(in srgb, var(--color-warn) 8%, transparent);
    color: var(--color-fg);
  }

  .conflict-banner strong {
    color: var(--color-warn);
    font-weight: 600;
    margin-right: 0.25rem;
  }

  .chat-banner,
  .persona-banner {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px dotted var(--color-border);
    opacity: 0.75;
  }

  .chat-banner a {
    color: var(--color-accent);
    text-decoration: none;
  }

  .editor-shell {
    flex: 1;
    overflow: hidden;
  }

  .empty,
  .error-msg {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 1rem;
    opacity: 0.7;
  }

  .error-msg {
    color: var(--color-danger);
  }
</style>
