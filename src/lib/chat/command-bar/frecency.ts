// Frecency scoring for the command chip bar.
//
// Pure functions; no side effects. The store (`stats.ts`) handles persistence;
// this module is the math.
//
// Algorithm: `score = count × 0.5^(age / halflife)`. Same shape as Firefox's
// URL bar and Sublime's command palette frecency, but using a true
// half-life rather than a 1/e time constant — at age = halflife the score
// is exactly halved. A command used heavily a month ago will not outrank
// one used five times this week.

const DEFAULT_HALFLIFE_MS = 14 * 24 * 60 * 60 * 1000;

export interface CommandStat {
  count: number;
  lastUsedAt: number;
}

export type CommandStats = Record<string, CommandStat>;

export interface FrecencyOptions {
  halflifeMs?: number;
}

export function frecencyScore(
  stat: CommandStat | undefined,
  now: number,
  options: FrecencyOptions = {},
): number {
  if (stat === undefined || stat.count === 0) return 0;
  const halflife = options.halflifeMs ?? DEFAULT_HALFLIFE_MS;
  const age = Math.max(0, now - stat.lastUsedAt);
  return stat.count * Math.pow(0.5, age / halflife);
}

export function recordUse(stats: CommandStats, command: string, now: number): CommandStats {
  const existing = stats[command];
  const next: CommandStat = {
    count: (existing?.count ?? 0) + 1,
    lastUsedAt: now,
  };
  return { ...stats, [command]: next };
}

export function orderByFrecency(
  commands: readonly string[],
  stats: CommandStats,
  now: number,
  options: FrecencyOptions = {},
): string[] {
  return [...commands].sort((a, b) => {
    const scoreA = frecencyScore(stats[a], now, options);
    const scoreB = frecencyScore(stats[b], now, options);
    if (scoreA !== scoreB) return scoreB - scoreA;
    // Stable tie-break: alphabetical so the order is deterministic.
    return a.localeCompare(b);
  });
}
