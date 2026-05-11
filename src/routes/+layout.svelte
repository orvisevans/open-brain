<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';

  import { initSession, getValidAccessToken } from '$lib/auth/session';
  import { logError } from '$lib/log';
  import { bootstrapMemory, filterSidecarConflicts } from '$lib/memory';
  import { auth, model, network, repo } from '$lib/state.svelte';
  import { syncEngine, type SyncStatus } from '$lib/sync';
  import { getStoredRepo } from '$lib/sync/repo-storage';
  import { ToastHost, toasts } from '$lib/toast';
  import '../app.css';

  const rawClientId: unknown = import.meta.env['VITE_GITHUB_CLIENT_ID'];
  const clientId = typeof rawClientId === 'string' ? rawClientId : '';

  // Token-refresh poll. Once a minute we ask the session manager for a
  // valid token; if the stored one is within 5 minutes of expiry it'll
  // exchange the refresh token for a new pair behind the scenes. Frequency
  // is conservative so a tab waking from sleep at the worst moment still
  // has a few minutes to refresh before any API call goes out.
  const REFRESH_CHECK_INTERVAL_MS = 60_000;

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

  // Hydrate the auth session (access + refresh + expiry) from IndexedDB on
  // mount, refreshing if needed. Without this the access token from a
  // prior tab/session expires after 8h and every API call 401s.
  $effect(() => {
    if (clientId === '') return;
    void (async () => {
      try {
        await initSession({ clientId });
      } catch (error: unknown) {
        logError('layout/init-session', { error });
      }
    })();
  });

  // Periodic token freshness check. getValidAccessToken refreshes
  // proactively when expiry is near; we don't care about the return
  // value, we just want the side-effect.
  $effect(() => {
    if (clientId === '') return;
    const id = globalThis.setInterval(() => {
      void getValidAccessToken().catch((error: unknown) => {
        logError('layout/refresh-tick', { error });
      });
    }, REFRESH_CHECK_INTERVAL_MS);
    return () => {
      globalThis.clearInterval(id);
    };
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

  // Bootstrap the memory pipeline once on mount: hydrate the embedding queue
  // from IndexedDB, start user-activity gates, and subscribe to vault writes.
  $effect(() => {
    bootstrapMemory();
  });

  // Live sync status — subscribed once, surfaced through this rune so the
  // status bar re-renders on every transition. The engine emits its current
  // value synchronously on subscribe, so `syncStatus` is initialised before
  // the first paint. Sidecar paths are filtered out before display: the
  // sidecar conflict resolver (started via `bootstrapMemory`) handles them
  // programmatically.
  let syncStatus = $state<SyncStatus>(filterSidecarConflicts(syncEngine.status.value));
  // Phase 9: track previous sync-status kind in a plain (non-reactive)
  // variable so the toast effect doesn't take a reactive dependency on
  // `syncStatus`. Reading `$state` inside the `$effect` body would make
  // the effect re-run on every status write — the effect's subscribe
  // call then fires synchronously with the current value and writes
  // again, creating an effect_update_depth_exceeded loop that kills
  // the whole layout (including unrelated routes like /setup's
  // device-code display). We initialise from the engine's raw value
  // rather than the `$state` rune so we don't trip the linter's
  // state-referenced-locally check either.
  let previousSyncKind: SyncStatus['kind'] = filterSidecarConflicts(syncEngine.status.value).kind;
  $effect(() => {
    return syncEngine.subscribe((next) => {
      const filtered = filterSidecarConflicts(next);
      // Surface a sync-error transition once via toast. Status-bar text
      // stays as the live indicator; the toast is for the moment the
      // failure happens (a user might miss a quiet color change in the
      // footer). Collapse-on-duplicate is handled by the store.
      if (filtered.kind === 'error' && previousSyncKind !== 'error') {
        toasts.show({
          message: `Sync failed: ${filtered.message}`,
          severity: 'error',
        });
      }
      previousSyncKind = filtered.kind;
      syncStatus = filtered;
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

  // Wall-clock that ticks every second so the "synced Xs ago" label
  // counts up live. Reads `now` inside the derived label, which makes
  // the label re-derive on every tick.
  let now = $state(Date.now());
  $effect(() => {
    const id = globalThis.setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => {
      globalThis.clearInterval(id);
    };
  });

  function formatSince(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${String(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${String(minutes)}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${String(hours)}h ago`;
    const days = Math.round(hours / 24);
    return `${String(days)}d ago`;
  }

  const syncStatusLabel = $derived.by(() => {
    const status = syncStatus;
    switch (status.kind) {
      case 'idle': {
        if (status.lastSyncAt === undefined) return '▲ idle';
        return `▲ synced ${formatSince(now - status.lastSyncAt)}`;
      }
      case 'pending': {
        return `◆ ${String(status.pendingPaths.length)} pending`;
      }
      case 'syncing': {
        return `◇ syncing (${status.phase})`;
      }
      case 'conflict': {
        return `! conflict (${String(status.paths.length)}) — resolve`;
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

  <ToastHost />

  <footer class="status-bar" aria-label="App status">
    <span class="status-auth">{auth.user ?? 'not signed in'}</span>
    <span class="status-model" aria-live="polite">{modelStatus}</span>
    {#if syncStatus.kind === 'conflict' && syncStatus.paths[0] !== undefined}
      <a
        class="status-sync sync-error sync-link"
        href={`/browse/${syncStatus.paths[0]}`}
        aria-label="Resolve conflict in {syncStatus.paths[0]}"
      >
        {syncStatusLabel}
      </a>
    {:else}
      <span
        class="status-sync"
        class:sync-error={syncStatus.kind === 'error'}
        class:sync-active={syncStatus.kind === 'syncing' || syncStatus.kind === 'pending'}
      >
        {syncStatusLabel}
      </span>
    {/if}
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

  .status-sync.sync-link {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .status-sync.sync-link:hover {
    opacity: 0.85;
  }

  .status-network.online {
    color: var(--color-ok);
  }

  .status-network.offline {
    color: var(--color-danger);
  }
</style>
