<script lang="ts">
  import { logError } from '$lib/log';
  import {
    embeddingQueue,
    extractionQueue,
    hashContent,
    isSidecarFresh,
    readSidecar,
  } from '$lib/memory';
  import type {
    EmbeddingQueueStatus,
    ExtractionQueueStatus,
    Sidecar,
    SidecarStatus,
  } from '$lib/memory';
  import { vault } from '$lib/vault';
  import type { NotePath } from '$lib/vault';

  interface Row {
    path: NotePath;
    status: SidecarStatus;
    sidecar?: Sidecar;
    extractedAt?: number;
    hasLLMExtraction?: boolean;
    error?: string;
  }

  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let selected = $state<NotePath | undefined>(undefined);
  let embedding = $state<EmbeddingQueueStatus>(embeddingQueue.status.value);
  let extraction = $state<ExtractionQueueStatus>(extractionQueue.status.value);

  $effect(() => embeddingQueue.subscribe((status) => (embedding = status)));
  $effect(() => extractionQueue.subscribe((status) => (extraction = status)));

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const paths = await vault.listNotes();
      const next: Row[] = await Promise.all(
        paths.map(async (path) => {
          try {
            const note = await vault.readNote(path);
            const noteHash = await hashContent(note.content);
            const sidecar = await readSidecar(vault, path);
            if (sidecar === undefined) {
              return queuedOrMissing(path);
            }
            const status: SidecarStatus = isSidecarFresh(noteHash, sidecar) ? 'fresh' : 'stale';
            return {
              path,
              status: embedding.pending.includes(path) ? 'queued' : status,
              sidecar,
              extractedAt: sidecar.extractedAt,
              hasLLMExtraction: sidecar.extractionModel !== undefined,
            };
          } catch (error: unknown) {
            return {
              path,
              status: 'error' as const,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      rows = next.sort((a, b) => a.path.localeCompare(b.path));
    } catch (error: unknown) {
      logError('memory/refresh-list', { error });
    } finally {
      loading = false;
    }
  }

  function queuedOrMissing(path: NotePath): Row {
    return {
      path,
      status: embedding.pending.includes(path) ? 'queued' : 'missing',
    };
  }

  $effect(() => {
    void refresh();
  });

  // Re-list when the embedding queue settles (so newly-fresh sidecars show
  // up). Triggered by reading `embedding.state` inside the effect.
  $effect(() => {
    void embedding.state;
    void refresh();
  });

  function handleRefreshAll(): void {
    void (async () => {
      // Enqueue any note whose sidecar isn't fresh — covers notes created in
      // an earlier session that never got their initial embedding run.
      const stale = rows.filter((row) => row.status !== 'fresh').map((row) => row.path);
      if (stale.length > 0) {
        embeddingQueue.enqueueAll(stale);
        extractionQueue.enqueueAll(stale);
      }
      await embeddingQueue.flush();
      await extractionQueue.flush();
      await refresh();
    })();
  }

  function selectRow(path: NotePath): void {
    selected = selected === path ? undefined : path;
  }

  const selectedSidecar = $derived(rows.find((row) => row.path === selected)?.sidecar);

  function formatTime(ms: number | undefined): string {
    if (ms === undefined) return '';
    const seconds = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (seconds < 60) return `${String(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${String(minutes)}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${String(hours)}h ago`;
    return `${String(Math.round(hours / 24))}d ago`;
  }

  function statusGlyph(status: SidecarStatus): string {
    switch (status) {
      case 'fresh': {
        return '●';
      }
      case 'stale': {
        return '◐';
      }
      case 'queued': {
        return '◇';
      }
      case 'missing': {
        return '○';
      }
      case 'error': {
        return '!';
      }
    }
  }

  const queueLabel = $derived.by(() => {
    if (embedding.pending.length === 0 && extraction.pending.length === 0) {
      return 'memory: up to date';
    }
    const parts: string[] = [];
    if (embedding.pending.length > 0) {
      parts.push(`${String(embedding.pending.length)} embedding`);
    }
    if (extraction.pending.length > 0) {
      const reason = extraction.pauseReason === undefined ? '' : ` (${extraction.pauseReason})`;
      parts.push(`${String(extraction.pending.length)} summary${reason}`);
    }
    return parts.join(' · ');
  });
</script>

<div class="memory">
  <header class="header">
    <h1>Memory</h1>
    <div class="actions">
      <span class="queue-chip" aria-live="polite">{queueLabel}</span>
      <button class="refresh" onclick={handleRefreshAll}>Refresh memory</button>
    </div>
  </header>

  {#if loading}
    <p class="loading">Scanning notes…</p>
  {:else if rows.length === 0}
    <p class="empty">No notes yet. Create one in Browse to start indexing.</p>
  {:else}
    <ul class="rows">
      {#each rows as row (row.path)}
        <li>
          <button
            class="row"
            class:selected={selected === row.path}
            onclick={() => {
              selectRow(row.path);
            }}
            aria-expanded={selected === row.path}
          >
            <span class="status status-{row.status}" aria-label={row.status}>
              {statusGlyph(row.status)}
            </span>
            <span class="path">{row.path}</span>
            {#if row.hasLLMExtraction === true}
              <span class="badge">summary</span>
            {/if}
            {#if row.extractedAt !== undefined}
              <span class="time">{formatTime(row.extractedAt)}</span>
            {/if}
          </button>
          {#if selected === row.path}
            <div class="detail">
              {#if selectedSidecar === undefined}
                <p class="dim">No sidecar yet. Embedding will run shortly.</p>
              {:else}
                {#if selectedSidecar.summary !== undefined}
                  <section>
                    <h2>Summary</h2>
                    <p>{selectedSidecar.summary}</p>
                  </section>
                {/if}
                {#if selectedSidecar.entities !== undefined && selectedSidecar.entities.length > 0}
                  <section>
                    <h2>Entities</h2>
                    <ul class="tags">
                      {#each selectedSidecar.entities as entity (entity.name + entity.type)}
                        <li class="tag">{entity.type}: {entity.name}</li>
                      {/each}
                    </ul>
                  </section>
                {/if}
                {#if selectedSidecar.facts !== undefined && selectedSidecar.facts.length > 0}
                  <section>
                    <h2>Facts</h2>
                    <ul class="facts">
                      {#each selectedSidecar.facts as fact (fact)}
                        <li>{fact}</li>
                      {/each}
                    </ul>
                  </section>
                {/if}
                {#if selectedSidecar.topics !== undefined && selectedSidecar.topics.length > 0}
                  <section>
                    <h2>Topics</h2>
                    <ul class="tags">
                      {#each selectedSidecar.topics as topic (topic)}
                        <li class="tag">{topic}</li>
                      {/each}
                    </ul>
                  </section>
                {/if}
                <section>
                  <h2>Embeddings</h2>
                  <p class="dim">
                    {String(selectedSidecar.embeddings.length)} chunk(s) · {String(
                      selectedSidecar.embeddings[0]?.vector.length ?? 0,
                    )} dims · {selectedSidecar.embeddingModel}
                  </p>
                </section>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .memory {
    max-width: 48rem;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    margin: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .queue-chip {
    color: var(--color-fg);
    opacity: 0.7;
  }

  .refresh {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    cursor: pointer;
    border-radius: 3px;
  }

  .loading,
  .empty {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    opacity: 0.7;
  }

  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    display: grid;
    grid-template-columns: 1.5rem 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    cursor: pointer;
  }

  .row.selected {
    border-color: var(--color-accent);
  }

  .status {
    text-align: center;
  }

  .status-fresh {
    color: var(--color-ok);
  }

  .status-stale {
    color: var(--color-warn, var(--color-accent));
  }

  .status-missing {
    color: var(--color-fg);
    opacity: 0.5;
  }

  .status-queued {
    color: var(--color-accent);
  }

  .status-error {
    color: var(--color-danger);
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    opacity: 0.8;
  }

  .time {
    opacity: 0.6;
    font-size: 0.75rem;
  }

  .detail {
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--color-accent);
    margin: 0.25rem 0 0.5rem 0.75rem;
    font-size: 0.85rem;
  }

  .detail h2 {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    text-transform: uppercase;
    margin: 0.5rem 0 0.25rem;
    opacity: 0.7;
  }

  .detail section:first-child h2 {
    margin-top: 0;
  }

  .detail p {
    margin: 0;
  }

  .tags,
  .facts {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .facts {
    flex-direction: column;
    gap: 0.2rem;
  }

  .tag {
    padding: 0.05rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    font-size: 0.75rem;
  }

  .dim {
    opacity: 0.6;
  }
</style>
