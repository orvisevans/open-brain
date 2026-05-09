// Auto-resolves sidecar merge conflicts (paths under `.memory/`).
//
// Why this exists: the user-facing conflict resolver UI is designed for
// markdown notes with diff3 markers in the body. Sidecars are
// machine-generated (long base64 vectors); surfacing them in the picker UI
// would be unreadable and pointless — sidecars are regenerable artefacts.
//
// Strategy:
//   1. Subscribe to SyncEngine status changes.
//   2. When status becomes `conflict`, scan the conflicted paths for any
//      under `.memory/`.
//   3. For each, parse the file's diff3 markers, extract both sides, parse
//      each as a sidecar. If both parse, keep whichever has the later
//      `extractedAt`. If only one parses, keep it. If neither parses, blank
//      the sidecar (the embedding queue will regenerate).
//   4. Write the chosen content back via the vault.
//   5. Call `syncEngine.markResolved(path)` so the engine re-queues the file.
//
// Reference: IMPLEMENTATION-PLAN-2026-04-17 §272 Phase 4 spec deltas.

import { logError } from '$lib/log';
import type { SyncEngine, SyncStatus } from '$lib/sync';
import type { NotePath } from '$lib/vault/types';

import { parseSidecar, isSidecarPath, sidecarToNotePath } from './sidecar-format';

export interface SidecarConflictResolverOptions {
  syncEngine: SyncEngine;
  vault: {
    readRaw(path: NotePath): Promise<string>;
    writeNote(path: NotePath, content: string): Promise<void>;
  };
  // Optional: when both sides fail to parse, signal the embedding queue to
  // regenerate the sidecar from scratch.
  onRegenerate?: (notePath: NotePath) => void;
}

export interface SidecarConflictResolver {
  /** Filters note-only conflict paths from a SyncStatus, leaving sidecars to us. */
  filterUserVisibleConflicts(status: SyncStatus): SyncStatus;
  /** Returns the set of sidecar paths in the most recent status. */
  pendingSidecars(): NotePath[];
  /** Stop subscribing. */
  stop(): void;
}

export function createSidecarConflictResolver(
  options: SidecarConflictResolverOptions,
): SidecarConflictResolver {
  const seen = new Set<NotePath>();
  let pendingSidecars: NotePath[] = [];
  const unsubscribe = options.syncEngine.subscribe((status) => {
    if (status.kind !== 'conflict') {
      seen.clear();
      pendingSidecars = [];
      return;
    }
    pendingSidecars = status.paths.filter((path) => isSidecarPath(path));
    for (const path of pendingSidecars) {
      if (seen.has(path)) continue;
      seen.add(path);
      void resolve(path).catch((error: unknown) => {
        logError('memory/sidecar-conflict-resolve', { path, error });
      });
    }
  });

  async function resolve(path: NotePath): Promise<void> {
    let raw: string;
    try {
      raw = await options.vault.readRaw(path);
    } catch (error: unknown) {
      logError('memory/sidecar-conflict/read', { path, error });
      return;
    }
    const sides = parseDiff3Sides(raw);
    const oursContent = sides.ours ?? raw;
    const theirsContent = sides.theirs ?? raw;
    const oursSidecar = tryParse(oursContent);
    const theirsSidecar = tryParse(theirsContent);

    let chosen: string | undefined;
    if (oursSidecar !== undefined && theirsSidecar !== undefined) {
      chosen = oursSidecar.extractedAt >= theirsSidecar.extractedAt ? oursContent : theirsContent;
    } else if (oursSidecar !== undefined) {
      chosen = oursContent;
    } else if (theirsSidecar !== undefined) {
      chosen = theirsContent;
    }

    if (chosen === undefined) {
      // Both sides corrupted — clear the file. The embedding queue will
      // regenerate when the source note is touched (or on the next refresh).
      await options.vault.writeNote(path, '');
      const notePath = sidecarToNotePath(path);
      if (notePath !== undefined && options.onRegenerate !== undefined) {
        options.onRegenerate(notePath);
      }
    } else {
      await options.vault.writeNote(path, chosen);
    }
    options.syncEngine.markResolved(path);
  }

  return {
    filterUserVisibleConflicts: filterStatus,
    pendingSidecars: () => [...pendingSidecars],
    stop: unsubscribe,
  };
}

function tryParse(content: string): { extractedAt: number } | undefined {
  try {
    const sidecar = parseSidecar(content);
    return { extractedAt: sidecar.extractedAt };
  } catch {
    return undefined;
  }
}

interface ConflictSides {
  ours?: string;
  theirs?: string;
}

// Splits a diff3-marked file into "ours" and "theirs" candidates by replacing
// every conflict block with the corresponding side's content. Files without
// markers are passed through unchanged.
export function parseDiff3Sides(content: string): ConflictSides {
  const startMarker = /^<{7} .+$/m;
  if (startMarker.exec(content) === null) {
    return { ours: content, theirs: content };
  }

  const lines = content.split('\n');
  const oursLines: string[] = [];
  const theirsLines: string[] = [];
  type Mode = 'common' | 'ours' | 'theirs';
  let mode: Mode = 'common';

  for (const line of lines) {
    if (/^<{7} /.test(line)) {
      mode = 'ours';
      continue;
    }
    if (/^={7}$/.test(line)) {
      mode = 'theirs';
      continue;
    }
    if (/^>{7} /.test(line)) {
      mode = 'common';
      continue;
    }
    if (mode === 'ours') {
      oursLines.push(line);
    } else if (mode === 'theirs') {
      theirsLines.push(line);
    } else {
      oursLines.push(line);
      theirsLines.push(line);
    }
  }

  return { ours: oursLines.join('\n'), theirs: theirsLines.join('\n') };
}

// Filters sidecar paths out of a SyncStatus so the user-facing UI doesn't
// surface them. Static helper that doesn't need the resolver instance.
export function filterStatus(status: SyncStatus): SyncStatus {
  if (status.kind !== 'conflict') return status;
  const userVisible = status.paths.filter((path) => !isSidecarPath(path));
  if (userVisible.length === 0) {
    // Nothing user-visible left — collapse to idle. (The engine will still
    // hold the sidecar paths; we re-emit when the resolver finishes them.)
    return { kind: 'idle', lastSyncAt: undefined };
  }
  return { kind: 'conflict', paths: userVisible };
}
