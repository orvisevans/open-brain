import { describe, expect, it } from 'vitest';

import {
  isReviewDue,
  loadLastReviewAt,
  recordReview,
  REVIEW_STATE_PATH,
  summariseFreshSuggestions,
  yesterdayHasContent,
  yesterdayJournalPath,
  type ReviewVault,
  type SuggestionCountVault,
} from '../daily-review';

function memVault(seed: Record<string, string> = {}): ReviewVault & {
  writes: Map<string, string>;
} {
  const writes = new Map(Object.entries(seed));
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

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 9, 7, 15);

describe('isReviewDue', () => {
  it('is due when no prior review exists', () => {
    expect(isReviewDue(undefined, NOW)).toBe(true);
  });

  it('is due when last review was over 24h ago', () => {
    expect(isReviewDue(NOW - 25 * HOUR, NOW)).toBe(true);
  });

  it('is not due when last review was within 24h', () => {
    expect(isReviewDue(NOW - 6 * HOUR, NOW)).toBe(false);
  });
});

describe('loadLastReviewAt / recordReview', () => {
  it('returns undefined for a missing file', async () => {
    expect(await loadLastReviewAt(memVault())).toBeUndefined();
  });

  it('round-trips through the vault', async () => {
    const vault = memVault();
    const at = new Date(NOW);
    await recordReview(vault, at);
    expect(vault.writes.get(REVIEW_STATE_PATH)).toBe(at.toISOString());
    const loaded = await loadLastReviewAt(vault);
    expect(loaded).toBe(at.getTime());
  });

  it('returns undefined for a malformed timestamp', async () => {
    const vault = memVault({ [REVIEW_STATE_PATH]: 'not-a-date' });
    expect(await loadLastReviewAt(vault)).toBeUndefined();
  });
});

describe('yesterdayJournalPath', () => {
  it('subtracts one day in UTC', () => {
    expect(yesterdayJournalPath(new Date(NOW))).toBe('journal/2026-05-08.md');
  });

  it('crosses month boundaries', () => {
    expect(yesterdayJournalPath(new Date(Date.UTC(2026, 5, 1)))).toBe('journal/2026-05-31.md');
  });
});

describe('yesterdayHasContent', () => {
  it('returns hasContent: false when the file is missing', async () => {
    const result = await yesterdayHasContent(memVault(), new Date(NOW));
    expect(result.path).toBe('journal/2026-05-08.md');
    expect(result.hasContent).toBe(false);
  });

  it('returns hasContent: false for tiny files (< 100 chars)', async () => {
    const result = await yesterdayHasContent(
      memVault({ 'journal/2026-05-08.md': 'just a stub' }),
      new Date(NOW),
    );
    expect(result.hasContent).toBe(false);
  });

  it('returns hasContent: true when the file has substantive content', async () => {
    const meaty = 'a'.repeat(200);
    const result = await yesterdayHasContent(
      memVault({ 'journal/2026-05-08.md': meaty }),
      new Date(NOW),
    );
    expect(result.hasContent).toBe(true);
  });
});

function suggestionsSidecar(source: string, generatedAt: string, count: number): string {
  const suggestions = Array.from({ length: count }, (_, index) => ({
    kind: 'idea',
    title: `s${String(index)}`,
    content: 'body',
  }));
  return JSON.stringify({
    schema_version: 1,
    source,
    source_hash: 'h',
    generated_at: generatedAt,
    suggestions,
  });
}

function suggestionVault(files: Record<string, string>, list: string[]): SuggestionCountVault {
  const base = memVault(files);
  return {
    ...base,
    listSuggestionPaths: () => Promise.resolve(list),
  };
}

describe('summariseFreshSuggestions', () => {
  const lastReviewAt = Date.UTC(2026, 4, 9, 0, 0);
  const beforeReview = '2026-05-08T12:00:00.000Z';
  const afterReview = '2026-05-09T18:00:00.000Z';

  it('returns zero when listSuggestionPaths is absent', async () => {
    const result = await summariseFreshSuggestions(memVault(), lastReviewAt);
    expect(result).toEqual({ freshSuggestionCount: 0, freshSources: [] });
  });

  it('counts suggestions generated after the cutoff', async () => {
    const vault = suggestionVault(
      {
        '.memory/journal/2026-05-09.md.suggestions.json': suggestionsSidecar(
          'journal/2026-05-09.md',
          afterReview,
          3,
        ),
        '.memory/.chats/x.md.suggestions.json': suggestionsSidecar('.chats/x.md', afterReview, 2),
      },
      ['.memory/journal/2026-05-09.md.suggestions.json', '.memory/.chats/x.md.suggestions.json'],
    );
    const result = await summariseFreshSuggestions(vault, lastReviewAt);
    expect(result.freshSuggestionCount).toBe(5);
    expect(result.freshSources.sort()).toEqual(['.chats/x.md', 'journal/2026-05-09.md']);
  });

  it('skips sidecars generated before the cutoff', async () => {
    const vault = suggestionVault(
      {
        '.memory/journal/old.md.suggestions.json': suggestionsSidecar(
          'journal/old.md',
          beforeReview,
          5,
        ),
      },
      ['.memory/journal/old.md.suggestions.json'],
    );
    const result = await summariseFreshSuggestions(vault, lastReviewAt);
    expect(result.freshSuggestionCount).toBe(0);
  });

  it('treats lastReviewAt=undefined as "everything is fresh"', async () => {
    const vault = suggestionVault(
      {
        '.memory/journal/old.md.suggestions.json': suggestionsSidecar(
          'journal/old.md',
          beforeReview,
          2,
        ),
      },
      ['.memory/journal/old.md.suggestions.json'],
    );
    const result = await summariseFreshSuggestions(vault);
    expect(result.freshSuggestionCount).toBe(2);
  });

  it('ignores sidecars with zero suggestions (auto-organize wrote empty caches)', async () => {
    const vault = suggestionVault(
      {
        '.memory/journal/empty.md.suggestions.json': suggestionsSidecar(
          'journal/empty.md',
          afterReview,
          0,
        ),
      },
      ['.memory/journal/empty.md.suggestions.json'],
    );
    const result = await summariseFreshSuggestions(vault, lastReviewAt);
    expect(result.freshSuggestionCount).toBe(0);
  });
});
