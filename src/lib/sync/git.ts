// Minimal isomorphic-git wrapper for Phase 1 walking skeleton.
// Phase 3 will expand this into the full SyncEngine.

import '$lib/polyfills';

import LightningFS from '@isomorphic-git/lightning-fs';
import { clone, listFiles as gitListFiles } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

// Shared filesystem instance — one IndexedDB-backed FS for the whole app.
export const fs = new LightningFS('openbrain-fs');

// All cloned repos live under this directory inside the virtual FS.
const REPO_DIR = '/repo';

// Same-origin CORS proxy for GitHub's git-over-HTTP endpoints. github.com does
// not set Access-Control-Allow-Origin on /info/refs or /git-upload-pack. We
// route through `/__gh_git`, which Vite proxies to github.com in dev (see
// vite.config.ts) and a first-party serverless function will serve in
// production (Phase 11).
// See IMPLEMENTATION-PLAN §10 Decision Log.
const CORS_PROXY = '/__gh_git';

/**
 * Shallow-clone a GitHub repository into the virtual filesystem.
 * Requires a valid OAuth token with `repo` scope.
 *
 * GitHub's git smart-HTTP endpoints authenticate via HTTP Basic (username + token),
 * NOT via `Authorization: token <pat>` — that form is for the REST API only and is
 * rejected by the git endpoints with 401. We use isomorphic-git's `onAuth` callback
 * so it constructs proper Basic auth; `x-access-token` is GitHub's documented
 * username placeholder for OAuth/PAT token auth over HTTPS.
 */
export async function cloneRepository(owner: string, name: string, token: string): Promise<void> {
  await clone({
    fs,
    http,
    dir: REPO_DIR,
    url: `https://github.com/${owner}/${name}.git`,
    corsProxy: CORS_PROXY,
    singleBranch: true,
    depth: 1,
    onAuth: () => ({ username: 'x-access-token', password: token }),
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
