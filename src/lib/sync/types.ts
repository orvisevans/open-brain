// Public types shared across the sync layer.
//
// `SyncStatus` mirrors ARCHITECTURE-2026-04-17 §3 with one extension: the
// `idle` kind carries the timestamp of the last successful push so the
// status bar can render `▲ synced 4s ago`.

// Import from the leaf types module rather than the `$lib/vault` barrel —
// the barrel wires the production vault to the SyncEngine, which would
// circle back here at module-evaluation time.
import type { NotePath } from '$lib/vault/types';

export type SyncStatus =
  | { kind: 'idle'; lastSyncAt: number | undefined }
  | { kind: 'pending'; pendingPaths: NotePath[] }
  | { kind: 'syncing'; phase: 'commit' | 'push' | 'pull' | 'merge' }
  | { kind: 'conflict'; paths: NotePath[] }
  | { kind: 'offline'; pendingPaths: NotePath[] }
  | { kind: 'error'; message: string };

export interface GitAuthor {
  name: string;
  email: string;
}

// Outcome of a pull. SyncEngine uses this to drive the conflict-tier
// dispatcher. `error` collapses both transport errors and merge engine
// failures (tier 3) — the SyncEngine inspects the original error to decide
// which behaviour to take.
export interface PullResult {
  kind: 'up-to-date' | 'fast-forward' | 'merged' | 'conflict' | 'error';
  conflictPaths?: NotePath[];
  message?: string;
}

// The contract SyncEngine talks to. `git.ts` ships the production
// implementation; tests pass a fake. Keeping the interface narrow keeps the
// engine unit-testable without dragging in isomorphic-git's surface area.
// Listener callback for SyncEngine status changes.
export type SyncListener = (status: SyncStatus) => void;

// Listener fired after a pull that actually advanced HEAD (i.e. brought
// new commits in from the remote). Consumers that hold cached file
// contents (the editor page) should re-read from disk.
export type RemoteChangeListener = () => void;

// Public surface of the engine. Declared in `types.ts` so `index.ts` can
// re-export it without forming a cycle through `engine.ts`.
export interface SyncEngine {
  readonly status: { value: SyncStatus };
  notifyChange(path: NotePath): void;
  /** Force the pending commit to fire now, ignoring the debounce. */
  flush(): Promise<void>;
  /** Trigger a pull. Used by the periodic poller and by manual "Sync" buttons. */
  pull(): Promise<void>;
  /** Mark a previously-conflicted path as resolved (after the user finished editing). */
  markResolved(path: NotePath): void;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  subscribe(listener: SyncListener): () => void;
  /**
   * Subscribe to "the working tree was updated by a pull" events. Fires only
   * when a pull actually advances HEAD; doesn't fire for no-op pulls.
   */
  onRemoteChange(listener: RemoteChangeListener): () => void;
}

export interface GitOps {
  // Paths whose workdir state differs from HEAD (modified or untracked).
  // `vault`-shaped: repo-relative, POSIX, no leading slash.
  changedPaths(): Promise<NotePath[]>;
  // Stage the given paths. Removed files are handled too — we infer deletion
  // from the workdir state and call git.remove instead.
  stage(paths: NotePath[]): Promise<void>;
  // Commit the staged paths with the supplied author + message. Returns the
  // commit oid for logging/debugging.
  commit(message: string, author: GitAuthor): Promise<string>;
  // Push the current branch to origin. Surfaces transport errors directly.
  push(token: string): Promise<void>;
  // Fetch + merge from origin into the current branch. Returns a structured
  // result so the engine can dispatch to the conflict tiers.
  pull(token: string, author: GitAuthor): Promise<PullResult>;
  // Resolve the current HEAD commit oid (or undefined when no repo cloned).
  // Used by the engine to detect whether a pull actually advanced HEAD.
  headOid(): Promise<string | undefined>;
}
