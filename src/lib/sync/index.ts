// Public sync API. Production callers import the singleton `syncEngine`;
// tests construct their own engine via `createSyncEngine` with a fake
// GitOps. The vault wires `onChange` into `syncEngine.notifyChange` (see
// `$lib/vault`), and the layout subscribes to status updates.

import { auth, network } from '$lib/state.svelte';

import { createSyncEngine } from './engine';
import { gitOps } from './git';
import type { GitAuthor, SyncEngine } from './types';

export type { SyncEngine, SyncStatus, GitAuthor, GitOps, PullResult } from './types';
export { createSyncEngine } from './engine';
export { gitOps, readWorkingFile, readWorkingFile as readSyncedFile } from './git';

// Author identity defaults — see IMPLEMENTATION-PLAN §10 (2026-05-05).
// We deliberately did NOT request the GitHub `user:email` scope, so
// device-flow tokens don't carry an email; we synthesize a no-reply.
function defaultAuthor(): GitAuthor {
  return {
    name: auth.user ?? 'open-brain',
    email: 'noreply@open-brain.local',
  };
}

export const syncEngine: SyncEngine = createSyncEngine({
  ops: gitOps,
  getToken: () => auth.token,
  getAuthor: defaultAuthor,
  isOnline: () => network.online,
});
