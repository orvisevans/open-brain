// Persistence for command frecency stats.
//
// Stats live at `.openbrain/command-stats.json` and ride the existing
// vault → sync pipeline, so the order syncs across devices. The path is
// excluded from the memory pipeline (see `notifyMemoryOfChange`) so writes
// don't trigger embedding extraction.
//
// Conflict resolution on the stats file: last-write-wins. Stats are advisory;
// if two devices race-write, one of the merge sides survives — the worst case
// is a chip orderchange, not data loss.

import type { NotePath } from '$lib/vault/types';

import type { CommandStats } from './frecency';

export const STATS_PATH: NotePath = '.openbrain/command-stats.json';

export interface StatsVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

export async function loadCommandStats(vault: StatsVault): Promise<CommandStats> {
  let raw: string;
  try {
    raw = await vault.readRaw(STATS_PATH);
  } catch (error: unknown) {
    if (isNotFound(error)) return {};
    throw error;
  }
  return parseStats(raw);
}

export async function saveCommandStats(vault: StatsVault, stats: CommandStats): Promise<void> {
  // Pretty-print for git-diff legibility — the file is tiny.
  await vault.writeNote(STATS_PATH, JSON.stringify(stats, undefined, 2));
}

function parseStats(raw: string): CommandStats {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const out: CommandStats = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const stat = entry as { count?: unknown; lastUsedAt?: unknown };
      if (typeof stat.count === 'number' && typeof stat.lastUsedAt === 'number') {
        out[key] = { count: stat.count, lastUsedAt: stat.lastUsedAt };
      }
    }
    return out;
  } catch {
    // Corrupted stats file: log via caller, return empty so the user isn't
    // blocked by malformed metadata.
    return {};
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
