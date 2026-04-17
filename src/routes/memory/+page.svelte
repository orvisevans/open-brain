<script lang="ts">
  import { logError } from '$lib/log';
  import { embed } from '$lib/embed/embedder';

  const SAMPLE_TEXT = 'hello world';
  const PREVIEW_DIMENSIONS = 5;

  type EmbedStep = 'idle' | 'loading' | 'done' | 'error';
  let embedStep = $state<EmbedStep>('idle');
  let dimensions = $state<number[]>([]);
  let totalDimensions = $state(0);

  function startEmbed() {
    embedStep = 'loading';
    dimensions = [];

    void (async () => {
      try {
        const vector = await embed(SAMPLE_TEXT);
        totalDimensions = vector.length;

        const preview: number[] = [];
        const count = Math.min(PREVIEW_DIMENSIONS, vector.length);
        for (let index = 0; index < count; index++) {
          const value = vector[index];
          if (value !== undefined) {
            preview.push(value);
          }
        }

        dimensions = preview;
        embedStep = 'done';
      } catch (error: unknown) {
        logError('memory/embed', { error });
        embedStep = 'error';
      }
    })();
  }
</script>

<div class="memory">
  <h1>Memory</h1>

  <section>
    <h2>Embedding probe</h2>
    <p>
      Embeds <code>"{SAMPLE_TEXT}"</code> using <code>all-MiniLM-L6-v2</code> and shows the first
      {String(PREVIEW_DIMENSIONS)} dimensions of the resulting vector.
    </p>

    {#if embedStep === 'idle' || embedStep === 'error'}
      {#if embedStep === 'error'}
        <p class="error">Embedding failed. Check the console for details.</p>
      {/if}
      <button onclick={startEmbed}>Embed "{SAMPLE_TEXT}"</button>
    {:else if embedStep === 'loading'}
      <p>Downloading model and computing embedding…</p>
    {:else if embedStep === 'done'}
      <p class="ok">
        ✓ Embedded. Vector has {String(totalDimensions)} dimensions. First {String(
          PREVIEW_DIMENSIONS,
        )}:
      </p>
      <pre class="vector">[{dimensions.map((d) => d.toFixed(4)).join(', ')}, …]</pre>
      <button onclick={startEmbed}>Re-embed</button>
    {/if}
  </section>
</div>

<style>
  .memory {
    max-width: 32rem;
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    margin-bottom: 1.5rem;
  }

  section {
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  h2 {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }

  button {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    border-radius: 3px;
    margin-top: 0.5rem;
  }

  .vector {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    overflow-x: auto;
    margin: 0.5rem 0;
  }

  .ok {
    color: var(--color-ok);
    font-size: 0.875rem;
  }

  .error {
    color: var(--color-danger);
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }
</style>
