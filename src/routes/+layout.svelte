<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';

  import { logError } from '$lib/log';
  import { auth, model, network, repo } from '$lib/state.svelte';
  import { syncEngine, type SyncStatus } from '$lib/sync';
  import { getStoredRepo } from '$lib/sync/repo-storage';
  import '../app.css';

  interface Properties {
    children?: Snippet;
  }

  const { children }: Properties = $props();

  // Hydrate the cloned-repo identity from IndexedDB on mount.
  $effect(() => {
    void (async () => {
      try {
        const stored = await getStoredRepo();
        if (stored !== undefined) {
          repo.owner = stored.owner;
          repo.name = stored.name;
        }
      } catch (error: unknown) {
        logError('layout/restore-repo', { error });
      }
    })();
  });

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

  // Live sync status — subscribed once, surfaced through this rune so the
  // status bar re-renders on every transition. The engine emits its current
  // value synchronously on subscribe, so `syncStatus` is initialised before
  // the first paint.
  let syncStatus = $state<SyncStatus>(syncEngine.status.value);
  $effect(() => {
    return syncEngine.subscribe((next) => {
      syncStatus = next;
    });
  });

  // Drive a periodic pull so a second device's edits land within ~30s. We
  // also pull immediately on mount and whenever the network flips back to
  // online.
  $effect(() => {
    void syncEngine.pull();

    const intervalId = globalThis.setInterval(() => {
      void syncEngine.pull();
    }, 30_000);

    const handleOnline = () => {
      void syncEngine.pull();
      void syncEngine.flush();
    };
    globalThis.addEventListener('online', handleOnline);

    return () => {
      globalThis.clearInterval(intervalId);
      globalThis.removeEventListener('online', handleOnline);
    };
  });

  const syncStatusLabel = $derived.by(() => {
    const status = syncStatus;
    switch (status.kind) {
      case 'idle': {
        if (status.lastSyncAt === undefined) return '▲ idle';
        const seconds = Math.max(0, Math.round((Date.now() - status.lastSyncAt) / 1000));
        return `▲ synced ${String(seconds)}s ago`;
      }
      case 'pending': {
        return `◆ ${String(status.pendingPaths.length)} pending`;
      }
      case 'syncing': {
        return `◇ syncing (${status.phase})`;
      }
      case 'conflict': {
        return `! conflict (${String(status.paths.length)})`;
      }
      case 'offline': {
        return `○ offline (${String(status.pendingPaths.length)} queued)`;
      }
      case 'error': {
        return `! sync error`;
      }
    }
  });

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
      class="status-sync"
      class:sync-error={syncStatus.kind === 'error' || syncStatus.kind === 'conflict'}
      class:sync-active={syncStatus.kind === 'syncing' || syncStatus.kind === 'pending'}
    >
      {syncStatusLabel}
    </span>
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

  .status-sync.sync-active {
    color: var(--color-accent);
  }

  .status-sync.sync-error {
    color: var(--color-danger);
  }

  .status-network.online {
    color: var(--color-ok);
  }

  .status-network.offline {
    color: var(--color-danger);
  }
</style>
