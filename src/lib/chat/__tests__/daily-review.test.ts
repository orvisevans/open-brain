import { describe, expect, it } from 'vitest';

import {
  isReviewDue,
  loadLastReviewAt,
  recordReview,
  REVIEW_STATE_PATH,
  yesterdayHasContent,
  yesterdayJournalPath,
  type ReviewVault,
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
