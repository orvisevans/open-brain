<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import FileTree from '$lib/browse/FileTree.svelte';
  import { search, type SearchHit, type SearchResult } from '$lib/browse/search';
  import { buildTree, type TreeNode } from '$lib/browse/tree';
  import { logError } from '$lib/log';
  import { auth, network, repo } from '$lib/state.svelte';
  import { vault, type NotePath } from '$lib/vault';

  interface Properties {
    children?: Snippet;
  }

  const { children }: Properties = $props();

  let notes = $state<NotePath[]>([]);
  let tree = $state<TreeNode[]>([]);
  let loading = $state(true);
  let listError = $state<string | undefined>(undefined);

  // Pulled out of the URL path; the [...path] dynamic param appears as
  // `params.path` on /browse/<...> and as undefined on bare /browse.
  const activePath = $derived.by((): NotePath | undefined => {
    const parameter: unknown = page.params.path;
    return typeof parameter === 'string' && parameter !== '' ? parameter : undefined;
  });

  async function refreshNotes(): Promise<void> {
    try {
      const list = await vault.listNotes();
      notes = list;
      tree = buildTree(list);
      listError = undefined;
    } catch (error: unknown) {
      logError('browse/list', { error });
      listError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void refreshNotes();
  });

  // Re-list when the active path changes — covers the case where the user
  // creates a new note via the button and we navigate to it.
  $effect(() => {
    void activePath;
    void refreshNotes();
  });

  // ── New-note button ──────────────────────────────────────────────────────

  let creating = $state(false);

  async function newNote(): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const path: NotePath = `notes/untitled-${String(Date.now())}.md`;
      await vault.writeNote(path, '');
      await refreshNotes();
      await goto(`/browse/${path}`);
    } catch (error: unknown) {
      logError('browse/new-note', { error });
    } finally {
      creating = false;
    }
  }

  // ── Search ───────────────────────────────────────────────────────────────

  const SEARCH_DEBOUNCE_MS = 250;

  let query = $state('');
  let results = $state<SearchHit[]>([]);
  let resultsSource = $state<'github' | 'local' | undefined>(undefined);
  let searching = $state(false);

  // Tracks the latest `runSearch` invocation so a slow earlier request
  // can't overwrite a faster later one (out-of-order completion).
  let searchToken = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function runSearch(): Promise<void> {
    const q = query.trim();
    if (q === '') {
      results = [];
      resultsSource = undefined;
      searching = false;
      return;
    }
    searchToken += 1;
    const myToken = searchToken;
    searching = true;
    try {
      const repoReference =
        repo.owner !== undefined && repo.name !== undefined
          ? { owner: repo.owner, name: repo.name }
          : undefined;
      const found: SearchResult = await search(q, repoReference, auth.token);
      // Discard if a newer search has started.
      if (myToken !== searchToken) return;
      results = [...found];
      resultsSource = found.source;
    } catch (error: unknown) {
      logError('browse/search', { error });
    } finally {
      if (myToken === searchToken) searching = false;
    }
  }

  function scheduleSearch(): void {
    if (searchTimer !== undefined) globalThis.clearTimeout(searchTimer);
    searchTimer = globalThis.setTimeout(() => {
      searchTimer = undefined;
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  // Auto-search as the user types: debounced so rapid keystrokes don't
  // hammer the GitHub API. Empty query immediately clears the results.
  $effect(() => {
    const q = query.trim();
    if (q === '') {
      // Cancel any pending debounced search and clear synchronously.
      if (searchTimer !== undefined) {
        globalThis.clearTimeout(searchTimer);
        searchTimer = undefined;
      }
      // Bump the token so any in-flight request is discarded on completion.
      searchToken += 1;
      results = [];
      resultsSource = undefined;
      searching = false;
      return;
    }
    scheduleSearch();
  });

  function handleSubmit(event: Event): void {
    event.preventDefault();
    // Pressing Enter fires immediately, bypassing the debounce.
    if (searchTimer !== undefined) {
      globalThis.clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    void runSearch();
  }
</script>

<div class="browse">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1>Notes</h1>
      <button type="button" class="new-note" onclick={() => void newNote()} disabled={creating}>
        + New
      </button>
    </div>

    <form class="search" onsubmit={handleSubmit}>
      <input
        type="search"
        placeholder="Search notes…"
        bind:value={query}
        aria-label="Search notes"
      />
      {#if !network.online}
        <span class="search-hint" title="Offline — searching local notes only">○</span>
      {/if}
    </form>

    {#if results.length > 0}
      <div class="results" aria-label="Search results">
        <div class="results-meta">
          {results.length} hit{results.length === 1 ? '' : 's'} ·
          <span class="source">{resultsSource ?? '—'}</span>
        </div>
        <ul>
          {#each results as hit (hit.path)}
            <li>
              <a href={`/browse/${hit.path}`}>{hit.path}</a>
              {#if hit.excerpt !== undefined}
                <p class="excerpt">{hit.excerpt}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {:else if query.trim() !== '' && !searching}
      <p class="empty">No matches.</p>
    {/if}

    <div class="tree-wrap">
      {#if loading}
        <p class="empty">Loading…</p>
      {:else if listError !== undefined}
        <p class="error">{listError}</p>
      {:else if notes.length === 0}
        <p class="empty">
          No notes yet. <a href="/setup">Clone a repo →</a>
        </p>
      {:else}
        <FileTree nodes={tree} {activePath} />
      {/if}
    </div>
  </aside>

  <section class="main">
    {@render children?.()}
  </section>
</div>

<style>
  .browse {
    display: grid;
    grid-template-columns: 16rem 1fr;
    height: calc(100dvh - 6rem); /* leave room for tab bar + status bar */
    margin: -1rem; /* cancel layout's content padding so we own this rectangle */
  }

  .sidebar {
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    margin: 0;
    opacity: 0.7;
  }

  .new-note {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
  }

  .new-note:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px dotted var(--color-border);
  }

  .search input {
    flex: 1;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.25rem 0.4rem;
    border-radius: 3px;
  }

  .search-hint {
    font-family: var(--font-mono);
    color: var(--color-warn);
    opacity: 0.8;
  }

  .results {
    border-bottom: 1px dotted var(--color-border);
    padding: 0.5rem 0.75rem;
    max-height: 14rem;
    overflow: auto;
  }

  .results-meta {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    opacity: 0.6;
    margin-bottom: 0.25rem;
  }

  .results .source {
    text-transform: uppercase;
  }

  .results ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .results a {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--color-accent);
    text-decoration: none;
  }

  .excerpt {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    opacity: 0.6;
    margin: 0.1rem 0 0;
  }

  .tree-wrap {
    flex: 1;
    overflow: auto;
    padding: 0.5rem 0.5rem 1rem;
  }

  .empty,
  .error {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0.6;
    padding: 0.5rem 0.75rem;
  }

  .error {
    color: var(--color-danger);
  }

  .main {
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
