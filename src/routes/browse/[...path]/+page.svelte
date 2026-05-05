<script lang="ts">
  import debounce from 'just-debounce-it';
  import { page } from '$app/state';

  import Editor from '$lib/browse/Editor.svelte';
  import { logError } from '$lib/log';
  import { vault, type NotePath } from '$lib/vault';

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

  // Load the note whenever the active path changes.
  $effect(() => {
    const current = path;
    if (current === undefined) return;

    loading = true;
    loadError = undefined;
    saveStatus = 'idle';

    void (async () => {
      try {
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

  // Debounced autosave — ~3s idle after last keystroke per IMPLEMENTATION-PLAN.
  // Recreate the debounced function whenever the path changes so a pending
  // save from the previous note doesn't write to the new one.
  const persist = $derived.by(() => {
    const current = path;
    if (current === undefined) {
      return (): void => {
        // No active note yet — discard the value rather than save it somewhere.
      };
    }
    return debounce(async (next: string): Promise<void> => {
      try {
        await vault.writeNote(current, next);
        saveStatus = 'saved';
      } catch (error: unknown) {
        logError('browse-detail/save', { path: current, error });
        saveStatus = 'error';
      }
    }, 3000);
  });

  function handleChange(next: string): void {
    content = next;
    saveStatus = 'pending';
    persist(next);
  }

  function getNotes(): readonly NotePath[] {
    return notesList;
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
      <Editor value={content} onChange={handleChange} notes={getNotes} />
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
