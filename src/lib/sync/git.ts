// isomorphic-git wrapper for Phase 1 (clone) + Phase 3 (sync ops).
//
// Every smart-HTTP entry point reuses the same defaults — `fs`, `http`,
// `corsProxy`, `dir` — via `withGitDefaults()`. Auth is HTTP Basic with
// `x-access-token` as the username (GitHub's documented username placeholder
// for OAuth/PAT auth over HTTPS) and the device-flow token as the password;
// the REST-style `Authorization: token <pat>` is rejected by smart-HTTP.

import '$lib/polyfills';

import LightningFS from '@isomorphic-git/lightning-fs';
import {
  Errors,
  add as gitAdd,
  checkout as gitCheckout,
  clone,
  commit as gitCommit,
  currentBranch,
  fetch as gitFetch,
  listFiles as gitListFiles,
  merge as gitMerge,
  push as gitPush,
  remove as gitRemove,
  resolveRef,
  statusMatrix,
} from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

import type { NotePath } from '$lib/vault/types';

import { diff3MergeDriver } from './merge-driver';
import type { GitAuthor, GitOps, PullResult, PushResult } from './types';

// Shared filesystem instance — one IndexedDB-backed FS for the whole app.
export const fs = new LightningFS('openbrain-fs');

// All cloned repos live under this directory inside the virtual FS.
const REPO_DIR = '/repo';

// Fallback branch when `git.currentBranch` returns undefined (e.g. detached
// HEAD, immediately after a fresh empty clone). GitHub defaults new repos
// to `main`, so the fallback is best-effort but not relied upon: most
// callsites read the actual checked-out ref via `getCurrentBranch()`.
const FALLBACK_BRANCH = 'main';

async function getCurrentBranch(): Promise<string> {
  const branch = await currentBranch({ fs, dir: REPO_DIR, fullname: false });
  if (typeof branch === 'string' && branch !== '') return branch;
  return FALLBACK_BRANCH;
}

// Same-origin CORS proxy for GitHub's git-over-HTTP endpoints. github.com does
// not set Access-Control-Allow-Origin on /info/refs or /git-upload-pack. We
// route through `/__gh_git`, which Vite proxies to github.com in dev (see
// vite.config.ts) and a first-party serverless function will serve in
// production (Phase 11).
// See IMPLEMENTATION-PLAN §10 Decision Log.
const CORS_PROXY = '/__gh_git';

interface GitDefaults {
  fs: typeof fs;
  http: typeof http;
  dir: string;
  corsProxy: string;
  onAuth?: () => { username: string; password: string };
  headers?: Record<string, string>;
}

function gitDefaults(token?: string): GitDefaults {
  const base: GitDefaults = { fs, http, dir: REPO_DIR, corsProxy: CORS_PROXY };
  if (token !== undefined) {
    base.onAuth = () => ({ username: 'x-access-token', password: token });
    // Send HTTP Basic auth on the FIRST request rather than waiting for
    // the server to 401-and-retry. Without this, every smart-HTTP op
    // produces a visible 401 on /info/refs (isomorphic-git's protocol
    // does an unauth probe by design and retries with onAuth credentials
    // after seeing the 401). With it, the first request is already
    // authenticated and we skip the noise. onAuth is still kept as a
    // fallback for any edge cases where the upfront header isn't honoured.
    base.headers = { Authorization: `Basic ${basicAuth('x-access-token', token)}` };
  }
  return base;
}

function basicAuth(username: string, password: string): string {
  return globalThis.btoa(`${username}:${password}`);
}

/**
 * Clone a GitHub repository into the virtual filesystem.
 * Requires a valid GitHub App user access token (per-installation scoped).
 *
 * We deliberately do NOT pass `depth: 1` — shallow clones interact poorly
 * with isomorphic-git's pull/merge: the merge-base walk can extend past
 * the shallow boundary, and pulls land on disk inconsistently. Note repos
 * are small enough that a full clone is fine. `singleBranch: true` is
 * preserved because we only ever sync the default branch.
 */
export async function cloneRepository(owner: string, name: string, token: string): Promise<void> {
  await clone({
    ...gitDefaults(token),
    url: `https://github.com/${owner}/${name}.git`,
    singleBranch: true,
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

// ── GitOps implementation ───────────────────────────────────────────────────

const HEAD_INDEX = 1;
const WORKDIR_INDEX = 2;

async function changedPaths(): Promise<NotePath[]> {
  try {
    const matrix = await statusMatrix({ fs, dir: REPO_DIR });
    // Any row where workdir differs from HEAD is a candidate for a commit.
    // (Includes untracked files — head=0, workdir=2 — and modified files.)
    return matrix.filter((row) => row[HEAD_INDEX] !== row[WORKDIR_INDEX]).map((row) => row[0]);
  } catch {
    // No repo cloned yet, or fs corruption. Either way, nothing to sync.
    return [];
  }
}

async function stage(paths: NotePath[]): Promise<void> {
  // For each path, decide between `git add` (workdir present) and `git remove`
  // (workdir absent). statusMatrix gives us the workdir column directly.
  const matrix = await statusMatrix({ fs, dir: REPO_DIR, filepaths: paths });
  const byPath = new Map<string, number>();
  for (const row of matrix) {
    byPath.set(row[0], row[WORKDIR_INDEX]);
  }
  for (const path of paths) {
    const workdir = byPath.get(path) ?? 0;
    await (workdir === 0
      ? gitRemove({ fs, dir: REPO_DIR, filepath: path })
      : gitAdd({ fs, dir: REPO_DIR, filepath: path }));
  }
}

async function commit(message: string, author: GitAuthor): Promise<string> {
  return gitCommit({
    fs,
    dir: REPO_DIR,
    message,
    author: { name: author.name, email: author.email },
  });
}

async function push(token: string): Promise<PushResult> {
  const branch = await getCurrentBranch();
  try {
    await gitPush({
      ...gitDefaults(token),
      ref: branch,
      remoteRef: branch,
    });
    return { kind: 'ok' };
  } catch (error: unknown) {
    if (error instanceof Errors.PushRejectedError) {
      // Remote moved on while we were composing our commit. The engine
      // recovers by pulling the divergent commits and re-pushing the merge.
      return { kind: 'rejected-non-fast-forward' };
    }
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pull(token: string, author: GitAuthor): Promise<PullResult> {
  try {
    // No cloned repo yet → nothing to pull. Without this guard, the periodic
    // pull from the layout fires after sign-in on /setup (before the user
    // has clicked Clone) and either ENOENTs against /repo or — worse, with
    // a stale /repo from a prior session — issues a real network request
    // that GitHub answers with 401 + WWW-Authenticate, popping a Basic-auth
    // dialog at the user.
    if ((await headOid()) === undefined) {
      return { kind: 'up-to-date' };
    }

    const branch = await getCurrentBranch();

    // We deliberately compose fetch + merge + checkout instead of calling
    // isomorphic-git's `pull`. The pull() wrapper does NOT accept
    // `mergeDriver` or `abortOnConflict` (they're not in its destructured
    // args), so passing them is a silent no-op — merge runs with defaults
    // (mergeFile driver, abortOnConflict: true), which throws on overlap
    // WITHOUT writing markers to the workdir. The editor then has nothing
    // to decorate and the user has no way to resolve. By calling merge()
    // ourselves we can pass our diff3-based driver that emits proper
    // <<<<<<< / ======= / >>>>>>> markers for the overlay to find.
    const fetchResult = await gitFetch({
      ...gitDefaults(token),
      ref: branch,
      singleBranch: true,
    });
    if (fetchResult.fetchHead === null) {
      // Nothing fetched. Either remote is empty or already up-to-date.
      return { kind: 'up-to-date' };
    }

    await gitMerge({
      fs,
      dir: REPO_DIR,
      ours: branch,
      theirs: fetchResult.fetchHead,
      author: { name: author.name, email: author.email },
      message: `Merge ${fetchResult.fetchHeadDescription ?? 'remote'}`,
      mergeDriver: diff3MergeDriver,
      abortOnConflict: false,
    });

    // Reflect any HEAD advance in the working tree. merge() updates the
    // index but the `pull` flow follows up with checkout to materialise
    // the new tree onto disk.
    await gitCheckout({
      fs,
      dir: REPO_DIR,
      ref: branch,
      noCheckout: false,
    });

    return { kind: 'merged' };
  } catch (error: unknown) {
    if (error instanceof Errors.MergeConflictError) {
      const conflictPaths = error.data.filepaths;
      // With our diff3 mergeDriver + abortOnConflict: false, the working
      // files now contain diff3 markers; the conflict-overlay extension
      // decorates them with keep-ours / keep-theirs buttons.
      return { kind: 'conflict', conflictPaths };
    }
    if (error instanceof Errors.MergeNotSupportedError) {
      // Tier 3: the merge engine couldn't handle this. Caller should write a
      // .conflict-<ts>.md backup and accept remote.
      return { kind: 'error', message: 'merge-not-supported' };
    }
    // Likely a network failure or bad token. Bubble up.
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const gitOps: GitOps = {
  changedPaths,
  stage,
  commit,
  push,
  pull,
  headOid,
};

// ── Helpers used by Phase 3 conflict tier 3 ────────────────────────────────

/**
 * Read a file from the virtual FS via fs.promises. Used by the SyncEngine
 * when constructing the .conflict-<ts>.md backup at tier 3 — the vault's
 * `readRaw` would also work, but routing through git.ts keeps all
 * direct fs access in this module.
 */
export async function readWorkingFile(path: NotePath): Promise<string> {
  return fs.promises.readFile(`${REPO_DIR}/${path}`, 'utf8');
}

/** Resolve the current HEAD commit oid; useful for diagnostics. */
export async function headOid(): Promise<string | undefined> {
  try {
    return await resolveRef({ fs, dir: REPO_DIR, ref: 'HEAD' });
  } catch {
    return undefined;
  }
}
