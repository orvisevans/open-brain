// Minimal isomorphic-git wrapper for Phase 1 walking skeleton.
// Phase 3 will expand this into the full SyncEngine.

import LightningFS from '@isomorphic-git/lightning-fs';
import { clone, listFiles as gitListFiles } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

// Shared filesystem instance — one IndexedDB-backed FS for the whole app.
export const fs = new LightningFS('openbrain-fs');

// All cloned repos live under this directory inside the virtual FS.
const REPO_DIR = '/repo';

/**
 * Shallow-clone a GitHub repository into the virtual filesystem.
 * Requires a valid OAuth token with `repo` scope.
 */
export async function cloneRepository(owner: string, name: string, token: string): Promise<void> {
  await clone({
    fs,
    http,
    dir: REPO_DIR,
    url: `https://github.com/${owner}/${name}.git`,
    singleBranch: true,
    depth: 1,
    headers: { Authorization: `token ${token}` },
  });
}

/**
 * List all tracked files in the cloned repo.
 * Returns an empty array if no repo has been cloned yet.
 */
export async function listFiles(): Promise<string[]> {
  try {
    return await gitListFiles({ fs, dir: REPO_DIR });
  } catch {
    return [];
  }
}
