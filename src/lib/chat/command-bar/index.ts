// Public API for the command-bar module.

export type { CommandStat, CommandStats, FrecencyOptions } from './frecency';
export { frecencyScore, orderByFrecency, recordUse } from './frecency';
export { loadCommandStats, saveCommandStats, STATS_PATH, type StatsVault } from './stats';

// The list rendered in the chip bar — kept in module scope so the chat page
// and any future consumer (intent suggester, settings) share a single source
// of truth for "what slash commands exist".
export const COMMAND_LIST: readonly string[] = [
  '/save',
  '/journal',
  '/note',
  '/list',
  '/append',
  '/organize',
  '/edit',
  '/related',
  '/find',
  '/archive',
  '/tag',
];
