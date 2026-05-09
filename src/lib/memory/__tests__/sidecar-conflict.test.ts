import { describe, expect, it } from 'vitest';

import type { SyncEngine, SyncStatus } from '$lib/sync';
import type { NotePath } from '$lib/vault/types';

import { createSidecarConflictResolver, filterStatus, parseDiff3Sides } from '../sidecar-conflict';
import { serializeSidecar } from '../sidecar-format';
import type { Sidecar } from '../types';
import { SIDECAR_SCHEMA_VERSION } from '../types';

import { FakeVault } from './fakes';

function noop(): void {
  /* no-op */
}

function makeSidecar(extractedAt: number, summary?: string): Sidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    source: 'notes/a.md',
    sourceHash: 'h',
    extractedAt,
    embeddingModel: 'test',
    embeddings: [{ index: 0, text: 't', vector: new Float32Array(384), start: 0, end: 1 }],
    ...(summary !== undefined && { summary }),
  };
}

class FakeSyncEngine implements SyncEngine {
  status = { value: { kind: 'idle', lastSyncAt: undefined } as SyncStatus };
  resolved: NotePath[] = [];
  private listeners: ((status: SyncStatus) => void)[] = [];

  emitConflict(paths: NotePath[]): void {
    this.status.value = { kind: 'conflict', paths };
    for (const listener of this.listeners) listener(this.status.value);
  }
  emitIdle(): void {
    this.status.value = { kind: 'idle', lastSyncAt: 1 };
    for (const listener of this.listeners) listener(this.status.value);
  }
  notifyChange(): void {
    /* no-op */
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  pull(): Promise<void> {
    return Promise.resolve();
  }
  markResolved(path: NotePath): void {
    this.resolved.push(path);
  }
  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.push(listener);
    listener(this.status.value);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }
  onRemoteChange(): () => void {
    return noop;
  }
}

describe('parseDiff3Sides', () => {
  it('returns the same content for both sides when no markers are present', () => {
    const sides = parseDiff3Sides('hello\nworld');
    expect(sides.ours).toBe('hello\nworld');
    expect(sides.theirs).toBe('hello\nworld');
  });

  it('extracts ours/theirs from a single conflict block', () => {
    const text = [
      'common',
      '<<<<<<< ours',
      'mine',
      '=======',
      'theirs',
      '>>>>>>> theirs',
      'after',
    ].join('\n');
    const { ours, theirs } = parseDiff3Sides(text);
    expect(ours).toBe(['common', 'mine', 'after'].join('\n'));
    expect(theirs).toBe(['common', 'theirs', 'after'].join('\n'));
  });
});

describe('filterStatus', () => {
  it('passes idle through unchanged', () => {
    const status: SyncStatus = { kind: 'idle', lastSyncAt: 1 };
    expect(filterStatus(status)).toEqual(status);
  });

  it('strips sidecar paths from a conflict status', () => {
    const status: SyncStatus = {
      kind: 'conflict',
      paths: ['notes/a.md', '.memory/notes/a.md'],
    };
    const filtered = filterStatus(status);
    expect(filtered.kind).toBe('conflict');
    expect(filtered.kind === 'conflict' ? filtered.paths : []).toEqual(['notes/a.md']);
  });

  it('collapses to idle when only sidecars are conflicted', () => {
    const status: SyncStatus = { kind: 'conflict', paths: ['.memory/notes/a.md'] };
    expect(filterStatus(status).kind).toBe('idle');
  });
});

describe('SidecarConflictResolver', () => {
  it('picks the side with the later extractedAt', async () => {
    const sync = new FakeSyncEngine();
    const vault = new FakeVault();
    const ours = serializeSidecar(makeSidecar(100, 'old'));
    const theirs = serializeSidecar(makeSidecar(200, 'new'));
    const conflicted = ['<<<<<<< ours', ours, '=======', theirs, '>>>>>>> theirs'].join('\n');
    vault.setSidecar('.memory/notes/a.md', conflicted);

    const resolver = createSidecarConflictResolver({ syncEngine: sync, vault });
    sync.emitConflict(['.memory/notes/a.md']);

    // Wait for the async resolve to finish. In production this is fire-and-
    // forget; here we yield enough microtasks for the parser/writer chain.
    for (let index = 0; index < 50; index += 1) await Promise.resolve();

    const stored = vault.getSidecar('.memory/notes/a.md') ?? '';
    // The parser is permissive — what matters is that the resolved file
    // contains the "newer" summary and not the older one.
    expect(stored).toContain('"summary": "new"');
    expect(stored).not.toContain('"summary": "old"');
    expect(sync.resolved).toEqual(['.memory/notes/a.md']);
    resolver.stop();
  });

  it('regenerates when both sides are unparseable', async () => {
    const sync = new FakeSyncEngine();
    const vault = new FakeVault();
    const conflicted = [
      '<<<<<<< ours',
      'garbage one',
      '=======',
      'garbage two',
      '>>>>>>> theirs',
    ].join('\n');
    vault.setSidecar('.memory/notes/a.md', conflicted);

    let regenPath: NotePath | undefined;
    const resolver = createSidecarConflictResolver({
      syncEngine: sync,
      vault,
      onRegenerate: (path) => {
        regenPath = path;
      },
    });
    sync.emitConflict(['.memory/notes/a.md']);
    for (let index = 0; index < 50; index += 1) await Promise.resolve();

    expect(regenPath).toBe('notes/a.md');
    expect(vault.getSidecar('.memory/notes/a.md')).toBe('');
    expect(sync.resolved).toEqual(['.memory/notes/a.md']);
    resolver.stop();
  });

  it('ignores non-sidecar conflict paths', async () => {
    const sync = new FakeSyncEngine();
    const vault = new FakeVault();
    const resolver = createSidecarConflictResolver({ syncEngine: sync, vault });
    sync.emitConflict(['notes/a.md']);
    for (let index = 0; index < 50; index += 1) await Promise.resolve();
    expect(sync.resolved).toEqual([]);
    resolver.stop();
  });
});
