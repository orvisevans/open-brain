// Public Vault API. Production callers import from `$lib/vault`; tests
// instantiate `createVault` directly with an in-memory FsLike shim.

import { fs as sharedFs } from '../sync/git';

import type { FsLike } from './fs-like';
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

export const vault: Vault = createVault(promisesFs);
