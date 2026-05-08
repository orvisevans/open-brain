<script lang="ts">
  import { page } from '$app/state';

  import Editor from '$lib/browse/Editor.svelte';
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
  // We skip the reload if there's a pending unsaved edit — reading would
  // clobber the user's in-flight changes; they'll see the merged version
  // after their save reaches the next pull cycle (which may itself become
  // a conflict if their edit overlaps).
  $effect(() => {
    return syncEngine.onRemoteChange(() => {
      const current = path;
      if (current === undefined) return;
      if (pendingSave !== undefined) return;
      void (async () => {
        try {
          const next = await vault.readRaw(current);
          if (next !== content) content = next;
        } catch (error: unknown) {
          logError('browse-detail/remote-change-read', { path: current, error });
        }
      })();
    });
  });

  function handleChange(next: string): void {
    const current = path;
    if (current === undefined) return;
    content = next;
    saveStatus = 'pending';
    scheduleSave(current, next);
  }

  function getNotes(): readonly NotePath[] {
    return notesList;
  }

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
  </header>

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

  .status.saved {
    color: var(--color-ok);
    opacity: 1;
  }

  .status.error {
    color: var(--color-danger);
    opacity: 1;
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
