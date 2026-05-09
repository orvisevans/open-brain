import { describe, expect, it } from 'vitest';

import { loadCommandStats, saveCommandStats, STATS_PATH, type StatsVault } from '../stats';

function memVault(seed?: string): StatsVault & { writes: Map<string, string> } {
  const writes = new Map<string, string>();
  if (seed !== undefined) writes.set(STATS_PATH, seed);
  return {
    readRaw: (path) => {
      const value = writes.get(path);
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code?: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    writeNote: (path, content) => {
      writes.set(path, content);
      return Promise.resolve();
    },
    writes,
  };
}

describe('loadCommandStats', () => {
  it('returns {} when the file is missing', async () => {
    const vault = memVault();
    const stats = await loadCommandStats(vault);
    expect(stats).toEqual({});
  });

  it('parses a well-formed stats file', async () => {
    const vault = memVault(JSON.stringify({ '/save': { count: 3, lastUsedAt: 100 } }));
    const stats = await loadCommandStats(vault);
    expect(stats['/save']).toEqual({ count: 3, lastUsedAt: 100 });
  });

  it('returns {} for malformed JSON', async () => {
    const vault = memVault('not json');
    expect(await loadCommandStats(vault)).toEqual({});
  });

  it('drops malformed entries but keeps valid ones', async () => {
    const vault = memVault(
      JSON.stringify({
        '/save': { count: 3, lastUsedAt: 100 },
        '/junk': 'not-an-object',
        '/missing-count': { lastUsedAt: 200 },
      }),
    );
    const stats = await loadCommandStats(vault);
    expect(stats['/save']).toBeDefined();
    expect(stats['/junk']).toBeUndefined();
    expect(stats['/missing-count']).toBeUndefined();
  });
});

describe('saveCommandStats', () => {
  it('writes pretty-printed JSON to the canonical path', async () => {
    const vault = memVault();
    await saveCommandStats(vault, { '/save': { count: 1, lastUsedAt: 42 } });
    const written = vault.writes.get(STATS_PATH);
    expect(written).toContain('"/save"');
    expect(written).toContain('"count": 1');
    expect(written).toContain('\n'); // pretty-printed
  });
});
