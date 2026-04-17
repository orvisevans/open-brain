<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';

  import { auth, model, network } from '$lib/state.svelte';
  import '../app.css';

  interface Properties {
    children?: Snippet;
  }

  const { children }: Properties = $props();

  // Wire up online/offline detection.
  $effect(() => {
    network.online = navigator.onLine;

    const handleOnline = () => {
      network.online = true;
    };
    const handleOffline = () => {
      network.online = false;
    };

    globalThis.addEventListener('online', handleOnline);
    globalThis.addEventListener('offline', handleOffline);

    return () => {
      globalThis.removeEventListener('online', handleOnline);
      globalThis.removeEventListener('offline', handleOffline);
    };
  });

  function isActive(path: string): boolean {
    return page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
  }

  // Formatted model status for the status bar.
  // Uses $derived.by to avoid a nested ternary that conflicts with unicorn's rule.
  const modelStatus = $derived.by(() => {
    if (model.loaded) {
      return `${model.id ?? 'model'} ready`;
    }
    if (model.loading) {
      return `loading ${String(Math.round(model.progress * 100))}%`;
    }
    return 'model not loaded';
  });
</script>

<div class="shell">
  <nav class="tab-bar" aria-label="Main navigation">
    <a href="/chat" aria-current={isActive('/chat') ? 'page' : undefined}>Chat</a>
    <a href="/browse" aria-current={isActive('/browse') ? 'page' : undefined}>Browse</a>
    <a href="/memory" aria-current={isActive('/memory') ? 'page' : undefined}>Memory</a>
    <a href="/setup" aria-current={isActive('/setup') ? 'page' : undefined}>Setup</a>
  </nav>

  <main class="content">
    {@render children?.()}
  </main>

  <footer class="status-bar" aria-label="App status">
    <span class="status-auth">{auth.user ?? 'not signed in'}</span>
    <span class="status-model">{modelStatus}</span>
    <span
      class="status-network"
      class:online={network.online}
      class:offline={!network.online}
      aria-label={network.online ? 'online' : 'offline'}
    >
      {network.online ? '●' : '○'}
    </span>
  </footer>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .tab-bar {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .tab-bar a {
    text-decoration: none;
    color: var(--color-fg);
    opacity: 0.6;
    padding: 0.25rem 0.5rem;
  }

  .tab-bar a[aria-current='page'] {
    opacity: 1;
    color: var(--color-accent);
  }

  .content {
    flex: 1;
    padding: 1rem;
  }

  .status-bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.25rem 1rem;
    border-top: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .status-auth {
    flex: 1;
  }

  .status-network.online {
    color: var(--color-ok);
  }

  .status-network.offline {
    color: var(--color-danger);
  }
</style>
