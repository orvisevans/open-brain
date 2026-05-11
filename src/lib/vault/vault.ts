// Vault — pure logic over a `fs.promises`-shaped backend.
//
// Public path type is `NotePath` (repo-relative POSIX, e.g. "notes/foo.md").
// The vault translates internally to absolute paths under `repoDirectory`
// (default `/repo`). It does not own the filesystem instance —
// `createVault(fs)` lets tests pass an in-memory shim and production pass the
// shared LightningFS from `$lib/sync/git`.

import { logError } from '../log';

import { parseFrontmatter } from './frontmatter';
import type { FsLike } from './fs-like';
import type { Note, NotePath } from './types';

export interface Vault {
  readNote(path: NotePath): Promise<Note>;
  // Returns the raw file contents, including any frontmatter block. Use this
  // when feeding the file to an editor — `readNote` strips frontmatter for
  // structured access, which would lose information on round-trip.
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
  listNotes(): Promise<NotePath[]>;
  // Lists chat session files under `.chats/`. Returns repo-relative paths
  // sorted alphabetically. Sibling to listNotes — kept separate so existing
  // notes-only callers (Browse note tree, retrieval over `notes/`) are
  // unaffected and so callers express intent explicitly. Phase 5.7.
  listChats(): Promise<NotePath[]>;
  // Lists app-settings markdown files under `.openbrain/` (persona, future
  // config). Phase 5.9. Excludes the `command-stats.json` and
  // `last-review-at` non-markdown bookkeeping files — only `.md`.
  listAppSettings(): Promise<NotePath[]>;
}

export interface VaultOptions {
  repoDirectory?: string;
  notesDirectory?: string;
  chatsDirectory?: string;
  appSettingsDirectory?: string;
  // Notified after a successful `writeNote`. The SyncEngine subscribes via
  // this hook in production; tests omit it. Errors during the callback are
  // logged but do not propagate — sync notification is best-effort.
  onChange?: (path: NotePath) => void;
}

const DEFAULT_REPO_DIRECTORY = '/repo';
const DEFAULT_NOTES_DIRECTORY = 'notes';
const DEFAULT_CHATS_DIRECTORY = '.chats';
const DEFAULT_APP_SETTINGS_DIRECTORY = '.openbrain';

export function createVault(fs: FsLike, options: VaultOptions = {}): Vault {
  const repoDirectory = options.repoDirectory ?? DEFAULT_REPO_DIRECTORY;
  const notesDirectory = options.notesDirectory ?? DEFAULT_NOTES_DIRECTORY;
  const chatsDirectory = options.chatsDirectory ?? DEFAULT_CHATS_DIRECTORY;
  const appSettingsDirectory = options.appSettingsDirectory ?? DEFAULT_APP_SETTINGS_DIRECTORY;

  function toAbsolute(path: NotePath): string {
    return joinPosix(repoDirectory, path);
  }

  async function readNote(path: NotePath): Promise<Note> {
    try {
      const content = await fs.readFile(toAbsolute(path), 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      const stats = await fs.stat(toAbsolute(path));
      return { path, content: body, frontmatter, lastModified: stats.mtimeMs };
    } catch (error: unknown) {
      logError('vault/read-note', { path, error });
      throw error;
    }
  }

  async function readRaw(path: NotePath): Promise<string> {
    try {
      return await fs.readFile(toAbsolute(path), 'utf8');
    } catch (error: unknown) {
      logError('vault/read-raw', { path, error });
      throw error;
    }
  }

  async function writeNote(path: NotePath, content: string): Promise<void> {
    try {
      const absolute = toAbsolute(path);
      await ensureDirectory(fs, parentDirectory(absolute));
      await fs.writeFile(absolute, content, { encoding: 'utf8' });
    } catch (error: unknown) {
      logError('vault/write-note', { path, error });
      throw error;
    }
    if (options.onChange !== undefined) {
      try {
        options.onChange(path);
      } catch (error: unknown) {
        logError('vault/on-change', { path, error });
      }
    }
  }

  async function listNotes(): Promise<NotePath[]> {
    const root = joinPosix(repoDirectory, notesDirectory);
    const out: NotePath[] = [];
    try {
      await walk(fs, root, out);
    } catch (error: unknown) {
      // Notes dir doesn't exist yet → empty vault. Anything else is a real
      // error worth surfacing to the caller.
      if (isNotFound(error)) {
        return [];
      }
      logError('vault/list-notes', { error });
      throw error;
    }
    return out
      .filter((path) => path.endsWith('.md'))
      .map((absolute) => relativeFrom(repoDirectory, absolute))
      .sort((a, b) => a.localeCompare(b));
  }

  async function listChats(): Promise<NotePath[]> {
    const root = joinPosix(repoDirectory, chatsDirectory);
    const out: NotePath[] = [];
    try {
      await walk(fs, root, out);
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return [];
      }
      logError('vault/list-chats', { error });
      throw error;
    }
    return out
      .filter((path) => path.endsWith('.md'))
      .map((absolute) => relativeFrom(repoDirectory, absolute))
      .sort((a, b) => a.localeCompare(b));
  }

  async function listAppSettings(): Promise<NotePath[]> {
    const root = joinPosix(repoDirectory, appSettingsDirectory);
    const out: NotePath[] = [];
    try {
      await walk(fs, root, out);
    } catch (error: unknown) {
      if (isNotFound(error)) return [];
      logError('vault/list-app-settings', { error });
      throw error;
    }
    return out
      .filter((path) => path.endsWith('.md'))
      .map((absolute) => relativeFrom(repoDirectory, absolute))
      .sort((a, b) => a.localeCompare(b));
  }

  return { readNote, readRaw, writeNote, listNotes, listChats, listAppSettings };
}

async function walk(fs: FsLike, current: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(current);
  for (const entry of entries) {
    if (entry === '.' || entry === '..') continue;
    const child = joinPosix(current, entry);
    const stats = await fs.stat(child);
    if (stats.isDirectory()) {
      await walk(fs, child, out);
    } else if (stats.isFile()) {
      out.push(child);
    }
  }
}

async function ensureDirectory(fs: FsLike, directory: string): Promise<void> {
  if (directory === '' || directory === '/') return;
  try {
    const stats = await fs.stat(directory);
    if (stats.isDirectory()) return;
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
  await ensureDirectory(fs, parentDirectory(directory));
  try {
    await fs.mkdir(directory);
  } catch (error: unknown) {
    // Race-tolerant: a parallel mkdir won the race.
    if (isAlreadyExists(error)) {
      return;
    }
    throw error;
  }
}

function joinPosix(...parts: string[]): string {
  const out: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (part === '') continue;
    if (index === 0) {
      out.push(part.replaceAll(/\/+$/g, ''));
      continue;
    }
    out.push(part.replaceAll(/^\/+|\/+$/g, ''));
  }
  return out.join('/');
}

function parentDirectory(absolute: string): string {
  const index = absolute.lastIndexOf('/');
  if (index <= 0) return '/';
  return absolute.slice(0, index);
}

function relativeFrom(base: string, absolute: string): string {
  const normalised = base.endsWith('/') ? base : `${base}/`;
  return absolute.startsWith(normalised) ? absolute.slice(normalised.length) : absolute;
}

function isNotFound(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, 'EEXIST');
}

function hasCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === 'string' && candidate === code;
}
