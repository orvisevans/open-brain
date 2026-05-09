<script lang="ts">
  import type { Proposal } from './types';

  interface Properties {
    proposal: Proposal;
    onApply: (proposal: Proposal) => Promise<void> | void;
    onDiscard: (proposal: Proposal) => void;
    onEdit?: (proposal: Proposal) => void;
  }

  const { proposal, onApply, onDiscard, onEdit }: Properties = $props();

  let pending = $state(false);
  let error = $state<string | undefined>(undefined);

  async function handleApply(): Promise<void> {
    if (pending) return;
    pending = true;
    error = undefined;
    try {
      await onApply(proposal);
    } catch (error_: unknown) {
      error = error_ instanceof Error ? error_.message : 'Apply failed';
      pending = false;
    }
  }

  // For `create` proposals the diff is the full content; for `append`/`replace`
  // we compute the added segment so the user sees only what's new highlighted.
  const addedSegment = $derived.by(() => {
    if (proposal.op === 'create') return proposal.finalContent;
    if (proposal.finalContent.startsWith(proposal.existingContent)) {
      return proposal.finalContent.slice(proposal.existingContent.length);
    }
    // Fallback for replace ops where the prefix doesn't match: show the whole
    // final content as the changed segment.
    return proposal.finalContent;
  });

  const opLabel = $derived.by(() => {
    switch (proposal.op) {
      case 'create': {
        return 'Create';
      }
      case 'append': {
        return 'Append to';
      }
      case 'replace': {
        return 'Replace';
      }
    }
  });
</script>

<div class="proposal-card" role="region" aria-label="Proposal: {proposal.summary}">
  <header class="proposal-head">
    <span class="proposal-op">{opLabel}</span>
    <code class="proposal-target">{proposal.target}</code>
  </header>
  {#if proposal.note !== undefined}
    <p class="proposal-note">{proposal.note}</p>
  {/if}

  <div class="proposal-diff" aria-label="Proposed change">
    {#if proposal.op !== 'create' && proposal.existingContent !== ''}
      <pre class="diff-context">{proposal.existingContent}</pre>
    {/if}
    <pre class="diff-added">{addedSegment}</pre>
  </div>

  {#if error !== undefined}
    <p class="proposal-error" role="alert">{error}</p>
  {/if}

  <div class="proposal-actions">
    <button
      class="apply"
      onclick={() => {
        void handleApply();
      }}
      disabled={pending}
    >
      {pending ? 'Applying…' : 'Apply'}
    </button>
    {#if onEdit !== undefined}
      <button
        class="edit"
        onclick={() => {
          onEdit(proposal);
        }}
        disabled={pending}
      >
        Edit then apply
      </button>
    {/if}
    <button
      class="discard"
      onclick={() => {
        onDiscard(proposal);
      }}
      disabled={pending}
    >
      Discard
    </button>
  </div>
</div>

<style>
  .proposal-card {
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-accent);
    padding: 0.75rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--color-bg);
  }

  .proposal-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .proposal-op {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  }

  .proposal-target {
    font-size: 0.875rem;
    color: var(--color-accent);
  }

  .proposal-note {
    font-size: 0.75rem;
    opacity: 0.7;
    margin: 0;
  }

  .proposal-diff {
    background: color-mix(in srgb, var(--color-bg), var(--color-fg) 4%);
    padding: 0.5rem;
    border-radius: 3px;
    max-height: 14rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .proposal-diff pre {
    margin: 0;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .diff-context {
    opacity: 0.55;
  }

  .diff-added {
    color: var(--color-ok, #2a9d8f);
  }

  .proposal-error {
    color: var(--color-danger, #e63946);
    font-size: 0.75rem;
    margin: 0;
  }

  .proposal-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .proposal-actions button {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    cursor: pointer;
  }

  .proposal-actions button.apply {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .proposal-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
