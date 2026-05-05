// In-memory `FsLike` shim for vault tests.
// Maps absolute POSIX paths to file or directory entries.
// Mirrors the small subset of `fs.promises` semantics the vault relies on.

import type { FsLike, FsStats } from '../fs-like';

interface FileEntry {
  type: 'file';
  content: string;
  mtimeMs: number;
}
interface DirectoryEntry {
  type: 'directory';
  mtimeMs: number;
}
type Entry = FileEntry | DirectoryEntry;

export class MemFs implements FsLike {
  private readonly entries = new Map<string, Entry>();
  private clock = 1;

  constructor() {
    this.entries.set('/', { type: 'directory', mtimeMs: this.tick() });
  }

  // Test helper for seeding state without going through writeFile.
  seedFile(path: string, content: string): void {
    const normalised = normalise(path);
    for (const ancestor of ancestors(normalised)) {
      if (!this.entries.has(ancestor)) {
        this.entries.set(ancestor, { type: 'directory', mtimeMs: this.tick() });
      }
    }
    this.entries.set(normalised, { type: 'file', content, mtimeMs: this.tick() });
  }

  readFile(path: string, _options: 'utf8' | { encoding: 'utf8' }): Promise<string> {
    void _options;
    const entry = this.entries.get(normalise(path));
    if (entry?.type !== 'file') {
      return Promise.reject(makeError('ENOENT', `no such file: ${path}`));
    }
    return Promise.resolve(entry.content);
  }

  writeFile(path: string, data: string, _options?: { encoding?: 'utf8' }): Promise<void> {
    void _options;
    const normalised = normalise(path);
    const parent = parentOf(normalised);
    const parentEntry = this.entries.get(parent);
    if (parentEntry?.type !== 'directory') {
      return Promise.reject(makeError('ENOENT', `parent does not exist: ${parent}`));
    }
    this.entries.set(normalised, { type: 'file', content: data, mtimeMs: this.tick() });
    return Promise.resolve();
  }

  readdir(path: string): Promise<string[]> {
    const normalised = normalise(path);
    const entry = this.entries.get(normalised);
    if (entry === undefined) {
      return Promise.reject(makeError('ENOENT', `no such directory: ${path}`));
    }
    if (entry.type !== 'directory') {
      return Promise.reject(makeError('ENOTDIR', `not a directory: ${path}`));
    }
    const prefix = normalised === '/' ? '/' : `${normalised}/`;
    const children = new Set<string>();
    for (const key of this.entries.keys()) {
      if (key === normalised) continue;
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      const slashIndex = remainder.indexOf('/');
      children.add(slashIndex === -1 ? remainder : remainder.slice(0, slashIndex));
    }
    return Promise.resolve([...children]);
  }

  mkdir(path: string): Promise<void> {
    const normalised = normalise(path);
    if (this.entries.has(normalised)) {
      return Promise.reject(makeError('EEXIST', `already exists: ${path}`));
    }
    const parent = parentOf(normalised);
    const parentEntry = this.entries.get(parent);
    if (parentEntry?.type !== 'directory') {
      return Promise.reject(makeError('ENOENT', `parent does not exist: ${parent}`));
    }
    this.entries.set(normalised, { type: 'directory', mtimeMs: this.tick() });
    return Promise.resolve();
  }

  stat(path: string): Promise<FsStats> {
    const entry = this.entries.get(normalise(path));
    if (entry === undefined) {
      return Promise.reject(makeError('ENOENT', `no such path: ${path}`));
    }
    const isDirectory = entry.type === 'directory';
    return Promise.resolve({
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      mtimeMs: entry.mtimeMs,
    });
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

function normalise(path: string): string {
  if (path === '') return '/';
  const collapsed = path.replaceAll(/\/+/g, '/');
  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) return '/';
  return path.slice(0, index);
}

function ancestors(path: string): string[] {
  const parts = path.split('/').filter((part) => part !== '');
  const out: string[] = ['/'];
  let cumulative = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    cumulative += `/${parts[index] ?? ''}`;
    out.push(cumulative);
  }
  return out;
}

function makeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
