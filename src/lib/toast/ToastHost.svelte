<script lang="ts">
  // Renders the live list of toasts from the production store. Mounted
  // once in the root layout; subscribes on mount, tears down on destroy.
  // Position is layout-aware via CSS — bottom-center on desktop, top of
  // the content area on mobile (design doc §9).
  //
  // The aria-live region is at the container level so screen readers
  // announce new toasts without re-announcing the whole list on each
  // change.

  import { onDestroy } from 'svelte';

  import { toasts, type Toast } from './store';

  let items = $state<Toast[]>([]);
  const unsubscribe = toasts.subscribe((next) => {
    items = next;
  });
  onDestroy(unsubscribe);
</script>

<div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
  {#each items as toast (toast.id)}
    <div
      class="toast"
      class:warn={toast.severity === 'warn'}
      class:error={toast.severity === 'error'}
      class:info={toast.severity === 'info'}
    >
      <span class="message">
        {toast.message}{#if toast.count > 1}
          <span class="count" aria-label="repeated {toast.count} times">
            (×{toast.count})
          </span>
        {/if}
      </span>
      {#if toast.action !== undefined}
        <button
          type="button"
          class="action"
          onclick={() => {
            toast.action?.onClick();
            toasts.dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      {/if}
      <button
        type="button"
        class="close"
        aria-label="Dismiss"
        onclick={() => {
          toasts.dismiss(toast.id);
        }}
      >
        ×
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    bottom: 2.5rem; /* leave room for the status bar */
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 1000;
    pointer-events: none;
    max-width: min(90vw, 32rem);
  }

  /* On narrow viewports, dock to the top of the content area instead so
   * the toast doesn't collide with the on-screen keyboard. */
  @media (max-width: 640px) {
    .toast-host {
      top: 3rem;
      bottom: auto;
    }
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.75rem;
    background: var(--color-bg-raised);
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    /* Tight shadow per design doc §6 — not soft, not large. */
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
  }

  .toast.warn {
    border-color: var(--color-warn);
  }
  .toast.error {
    border-color: var(--color-danger);
  }

  .message {
    flex: 1;
    line-height: 1.4;
  }

  .count {
    opacity: 0.6;
    margin-left: 0.25rem;
  }

  .action {
    background: transparent;
    color: var(--color-accent);
    border: 1px solid var(--color-accent);
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    cursor: pointer;
  }

  .close {
    background: transparent;
    color: var(--color-fg-muted);
    border: none;
    padding: 0 0.25rem;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }
</style>
