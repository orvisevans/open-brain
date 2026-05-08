// SyncEngine — debounced commit/push pipeline for vault changes.
//
// State machine (driven by `notifyChange` and the debounce timer):
//
//   idle ──notifyChange──▶ pending ──debounce expires──▶ syncing ──ok──▶ idle
//                                                              ╰──conflict──▶ conflict
//                                                              ╰──error──────▶ error
//
// Inputs:
//   - `notifyChange(path)` from the vault on every successful write.
//   - `pull(token)` triggered manually (or on a periodic timer set up by the
//     consumer; the engine itself doesn't own a wall-clock interval).
//
// Outputs:
//   - `status`: read-only `SyncStatus` reactive value (`status.value`).
//   - `subscribe(listener)`: notification on every status change.
//
// Two pieces of intentional design from the IMPLEMENTATION-PLAN review:
//   1. Stacked debounces are intentional — editor's 3s + sync's 5s = ~8s
//      max time-from-keystroke-to-GitHub. Don't collapse them.
//   2. The engine talks to `GitOps`, not isomorphic-git. Tests inject a fake.

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

import type {
  GitAuthor,
  GitOps,
  RemoteChangeListener,
  SyncEngine,
  SyncListener,
  SyncStatus,
} from './types';

export interface SyncEngineOptions {
  ops: GitOps;
  // Resolves the current device-flow token (and `undefined` when signed out).
  // Read each push/pull because the user can sign in mid-session.
  getToken: () => string | undefined;
  // Resolves the current commit author. Read each commit because the user
  // login may not yet be hydrated when the engine is constructed.
  getAuthor: () => GitAuthor;
  // Network signal. The engine pauses pushes when offline and queues changes;
  // flushes when online flips back to true.
  isOnline: () => boolean;
  // Time between the last vault write and the auto-commit. Defaults to 5s
  // per the architecture doc.
  debounceMs?: number;
  // Indirection points kept open for tests. Production passes nothing.
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  nowImpl?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 5000;

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  // Wrap the platform timers so the bound types stay stable. globalThis's
  // overload union (browser `Timeout` vs node `Timeout`) confuses TS when
  // assigned to a parameter type — wrapping erases that.
  const setTimer: (handler: () => void, ms: number) => unknown =
    options.setTimeoutImpl ?? ((handler, ms) => globalThis.setTimeout(handler, ms));
  const clearTimer: (handle: unknown) => void =
    options.clearTimeoutImpl ??
    ((handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const now = options.nowImpl ?? (() => Date.now());

  const pending = new Set<NotePath>();
  const conflicts = new Set<NotePath>();
  let timer: unknown;
  let lastSyncAt: number | undefined;

  const status = { value: initialStatus() };
  const listeners = new Set<SyncListener>();
  const remoteChangeListeners = new Set<RemoteChangeListener>();

  function setStatus(next: SyncStatus): void {
    status.value = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error: unknown) {
        logError('sync/listener', { error });
      }
    }
  }

  function recomputeIdle(): void {
    if (conflicts.size > 0) {
      setStatus({ kind: 'conflict', paths: [...conflicts] });
      return;
    }
    if (pending.size === 0) {
      setStatus({ kind: 'idle', lastSyncAt });
      return;
    }
    if (!options.isOnline()) {
      setStatus({ kind: 'offline', pendingPaths: [...pending] });
      return;
    }
    setStatus({ kind: 'pending', pendingPaths: [...pending] });
  }

  function scheduleFlush(): void {
    if (timer !== undefined) {
      clearTimer(timer);
    }
    timer = setTimer(() => {
      timer = undefined;
      void runFlush();
    }, debounceMs);
  }

  async function runFlush(): Promise<void> {
    if (pending.size === 0) return;
    if (!options.isOnline()) {
      // Still offline — re-emit the offline status and bail. The caller's
      // online-listener will retrigger us.
      recomputeIdle();
      return;
    }
    const token = options.getToken();
    if (token === undefined) {
      // Signed out mid-edit. Hold the pending set; surfacing as `error` would
      // be misleading.
      recomputeIdle();
      return;
    }

    const paths = [...pending];
    pending.clear();

    try {
      setStatus({ kind: 'syncing', phase: 'commit' });
      await options.ops.stage(paths);
      const message = `open-brain: sync ${new Date(now()).toISOString()}`;
      await options.ops.commit(message, options.getAuthor());

      setStatus({ kind: 'syncing', phase: 'push' });
      await options.ops.push(token);

      logSyncEvent('push', { paths });
      lastSyncAt = now();
      recomputeIdle();
    } catch (error: unknown) {
      logError('sync/flush', { error });
      // Re-queue the paths so a retry picks them up.
      for (const path of paths) pending.add(path);
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function pull(): Promise<void> {
    const token = options.getToken();
    if (token === undefined) return;
    if (!options.isOnline()) return;

    setStatus({ kind: 'syncing', phase: 'pull' });
    // Snapshot HEAD before pull so we can tell if the merge actually
    // advanced the working tree. A no-op pull (already up-to-date) leaves
    // HEAD unchanged; a successful merge advances it. We fire remote-change
    // listeners only when HEAD moves, so subscribers (the editor page) can
    // skip an unnecessary disk re-read on every 30s tick.
    const headBefore = await safeHeadOid();
    try {
      const result = await options.ops.pull(token, options.getAuthor());
      const headAfter = await safeHeadOid();
      const advanced =
        headBefore !== undefined && headAfter !== undefined && headBefore !== headAfter;
      logSyncEvent('pull', { kind: result.kind, advanced, headBefore, headAfter });

      switch (result.kind) {
        case 'up-to-date':
        case 'fast-forward':
        case 'merged': {
          // Anything pulled may now have conflict-overlap paths — but a
          // 'merged' result from isomorphic-git means clean merge with no
          // user-visible conflicts. Clear any stale conflicts and resume.
          conflicts.clear();
          recomputeIdle();
          if (advanced) emitRemoteChange();
          break;
        }
        case 'conflict': {
          for (const path of result.conflictPaths ?? []) {
            conflicts.add(path);
          }
          setStatus({ kind: 'conflict', paths: [...conflicts] });
          // The working tree was modified (conflict markers written in);
          // editor needs to re-read so the user sees them.
          emitRemoteChange();
          break;
        }
        case 'error': {
          // Tier 3 (`merge-not-supported`) lands here. The plan calls for
          // auto-writing `<path>.conflict-<ISO>.md` backups + resetting
          // workdir to remote, but that's a destructive multi-step sequence
          // that's risky to ship without browser-level testing on a real
          // merge-engine failure. We surface a clear error for now and
          // leave auto-recovery as a follow-up. Users can reset manually
          // by re-cloning. See IMPLEMENTATION-PLAN §10 (2026-05-05 Phase 3).
          const message =
            result.message === 'merge-not-supported'
              ? 'merge-engine failure — please re-clone the repo to recover'
              : (result.message ?? 'pull failed');
          setStatus({ kind: 'error', message });
          break;
        }
      }
    } catch (error: unknown) {
      logError('sync/pull', { error });
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function safeHeadOid(): Promise<string | undefined> {
    try {
      return await options.ops.headOid();
    } catch {
      return undefined;
    }
  }

  function emitRemoteChange(): void {
    for (const listener of remoteChangeListeners) {
      try {
        listener();
      } catch (error: unknown) {
        logError('sync/remote-change-listener', { error });
      }
    }
  }

  function notifyChange(path: NotePath): void {
    pending.add(path);
    if (!options.isOnline()) {
      recomputeIdle();
      return;
    }
    setStatus({ kind: 'pending', pendingPaths: [...pending] });
    scheduleFlush();
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    await runFlush();
  }

  function markResolved(path: NotePath): void {
    conflicts.delete(path);
    pending.add(path);
    recomputeIdle();
    scheduleFlush();
  }

  function subscribe(listener: SyncListener): () => void {
    listeners.add(listener);
    listener(status.value);
    return () => listeners.delete(listener);
  }

  function onRemoteChange(listener: RemoteChangeListener): () => void {
    remoteChangeListeners.add(listener);
    return () => remoteChangeListeners.delete(listener);
  }

  return { status, notifyChange, flush, pull, markResolved, subscribe, onRemoteChange };
}

function initialStatus(): SyncStatus {
  return { kind: 'idle', lastSyncAt: undefined };
}

// Lightweight diagnostic logger for sync activity. Routed through console.warn
// (the only browser-info channel allowed by lint) so it shows up in DevTools
// alongside the existing logError output. Useful when remote-change behaviour
// looks suspicious — e.g. you suspect pulls aren't firing or aren't picking up
// commits.
function logSyncEvent(event: string, context: Record<string, unknown>): void {
  console.warn(`[open-brain/sync/${event}]`, context);
}
