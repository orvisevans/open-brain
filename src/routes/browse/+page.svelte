<script lang="ts">
  import { logError } from '$lib/log';
  import { listFiles } from '$lib/sync/git';

  let files = $state<string[]>([]);
  let loading = $state(true);
  let hasRepo = $state(false);

  $effect(() => {
    void (async () => {
      try {
        const result = await listFiles();
        files = result;
        hasRepo = result.length > 0;
        loading = false;
      } catch (error: unknown) {
        logError('browse/list-files', { error });
        loading = false;
      }
    })();
  });
</script>

<div class="browse">
  <h1>Browse</h1>

  {#if loading}
    <p>Loading…</p>
  {:else if !hasRepo}
    <p>No repository cloned yet. <a href="/setup">Clone one in Setup →</a></p>
  {:else}
    <p class="count">{String(files.length)} file{files.length === 1 ? '' : 's'}</p>
    <ul class="file-list">
      {#each files as file (file)}
        <li><span class="filename">{file}</span></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .browse {
    max-width: 40rem;
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    margin-bottom: 1rem;
  }

  .count {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    opacity: 0.6;
    margin-bottom: 0.5rem;
  }

  .file-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .file-list li {
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--color-border);
  }

  .filename {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
