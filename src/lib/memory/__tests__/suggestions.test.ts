import { describe, expect, it } from 'vitest';

import {
  readSuggestions,
  suggestionsPathFor,
  writeSuggestions,
  type Suggestion,
  type SuggestionSidecar,
  type SuggestionsVault,
  SUGGESTIONS_SCHEMA_VERSION,
} from '../suggestions';

function memVault(seed: Record<string, string> = {}): SuggestionsVault & {
  writes: Map<string, string>;
} {
  const writes = new Map<string, string>(Object.entries(seed));
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

const sampleSidecar = (): SuggestionSidecar => ({
  schema_version: SUGGESTIONS_SCHEMA_VERSION,
  source: 'journal/2026-05-09.md',
  source_hash: 'abc123',
  generated_at: '2026-05-09T07:15:00.000Z',
  suggestions: [
    {
      kind: 'idea',
      title: 'Caching strategy',
      content: 'Hash and store locally.',
      excerpt: 'cache LLM outputs',
    },
  ],
});

describe('suggestionsPathFor', () => {
  it('mirrors the embedding sidecar convention under .memory/', () => {
    expect(suggestionsPathFor('journal/2026-05-09.md')).toBe(
      '.memory/journal/2026-05-09.md.suggestions.json',
    );
  });
});

describe('readSuggestions / writeSuggestions', () => {
  it('round-trips a sidecar', async () => {
    const vault = memVault();
    await writeSuggestions(vault, sampleSidecar());
    const read = await readSuggestions(vault, 'journal/2026-05-09.md');
    expect(read).toEqual(sampleSidecar());
  });

  it('returns undefined when the sidecar is missing', async () => {
    const vault = memVault();
    expect(await readSuggestions(vault, 'journal/2026-05-09.md')).toBeUndefined();
  });

  it('returns undefined for a malformed sidecar', async () => {
    const vault = memVault({
      [suggestionsPathFor('journal/2026-05-09.md')]: 'not json',
    });
    expect(await readSuggestions(vault, 'journal/2026-05-09.md')).toBeUndefined();
  });

  it('drops malformed suggestion entries', async () => {
    const sidecar: Record<string, unknown> = {
      schema_version: SUGGESTIONS_SCHEMA_VERSION,
      source: 'journal/x.md',
      source_hash: 'h',
      generated_at: 'now',
      suggestions: [
        { kind: 'idea', title: 'good', content: 'body' } satisfies Suggestion,
        { kind: 'idea', title: 'bad' }, // no content
        'not-an-object',
      ],
    };
    const vault = memVault({
      [suggestionsPathFor('journal/x.md')]: JSON.stringify(sidecar),
    });
    const read = await readSuggestions(vault, 'journal/x.md');
    expect(read?.suggestions).toHaveLength(1);
    expect(read?.suggestions[0]?.title).toBe('good');
  });

  it('rejects sidecars with the wrong schema_version', async () => {
    const vault = memVault({
      [suggestionsPathFor('x.md')]: JSON.stringify({
        ...sampleSidecar(),
        schema_version: 999,
      }),
    });
    expect(await readSuggestions(vault, 'x.md')).toBeUndefined();
  });
});
