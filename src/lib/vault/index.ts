// Public Vault API. Production callers import from `$lib/vault`; tests
// instantiate `createVault` directly with an in-memory FsLike shim.

import { logError } from '../log';
import { syncEngine } from '../sync';
import { fs as sharedFs } from '../sync/git';

import type { FsLike } from './fs-like';
import type { NotePath } from './types';
import { createVault, type Vault } from './vault';

export type { Note, NotePath, ParsedMarkdown, WikilinkReference } from './types';
export type { FsLike, FsStats } from './fs-like';
export { parseFrontmatter } from './frontmatter';
export { extractWikilinks } from './wikilinks';
export { createVault } from './vault';
export type { Vault, VaultOptions } from './vault';

// LightningFS's `.promises` has slightly different overload signatures than
// our minimal `FsLike` (e.g. options are `string | object` rather than just
// the object form). The runtime shape matches; the structural cast below is
// the cheapest way to bridge that without bringing the lightning-fs types
// into our module's public surface.
const promisesFs = sharedFs.promises as unknown as FsLike;

// Fan-out for vault writes. The sync engine subscribes here (commit/push);
// the memory pipeline subscribes too (embedding queue). Tests don't use
// this — they construct their own vault via `createVault`.
const changeListeners = new Set<(path: NotePath) => void>();

export function subscribeToVaultChanges(listener: (path: NotePath) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export const vault: Vault = createVault(promisesFs, {
  onChange: (path) => {
    for (const listener of changeListeners) {
      try {
        listener(path);
      } catch (error: unknown) {
        logError('vault/change-listener', { path, error });
      }
    }
  },
});

// The sync engine is always the first subscriber. We register here at module
// evaluation so callers don't need to remember to wire it up.
subscribeToVaultChanges((path) => {
  syncEngine.notifyChange(path);
});
