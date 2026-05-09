import { describe, expect, it } from 'vitest';

import { searchMentions } from '../matcher';

const PATHS = [
  'notes/grocery.md',
  'notes/groceries-archive.md',
  'lists/grocery.md',
  'notes/work-meeting.md',
  'journal/2026-05-09.md',
];

describe('searchMentions', () => {
  it('returns alphabetical paths when query is empty', () => {
    const result = searchMentions(PATHS, '');
    // Note: 'groceries' < 'grocery' alphabetically because 'i' < 'y'.
    expect(result.map((match) => match.path)).toEqual([
      'journal/2026-05-09.md',
      'lists/grocery.md',
      'notes/groceries-archive.md',
      'notes/grocery.md',
      'notes/work-meeting.md',
    ]);
  });

  it('matches case-insensitive infix on basename', () => {
    const result = searchMentions(PATHS, 'GRO');
    const paths = result.map((match) => match.path);
    expect(paths).toContain('notes/grocery.md');
    expect(paths).toContain('lists/grocery.md');
    expect(paths).toContain('notes/groceries-archive.md');
  });

  it('prefers prefix matches over infix', () => {
    const result = searchMentions(PATHS, 'gro');
    // grocery.md (prefix on basename) should outrank groceries-archive (also
    // prefix but longer). Both should outrank a hypothetical mid-path match.
    const top = result[0];
    expect(top?.path).toMatch(/grocery\.md$/);
  });

  it('prefers shorter paths on tie', () => {
    const result = searchMentions(PATHS, 'grocery');
    expect(result[0]?.path).toBe('lists/grocery.md');
  });

  it('respects the limit', () => {
    const result = searchMentions(PATHS, '', 2);
    expect(result).toHaveLength(2);
  });

  it('returns empty when no path matches', () => {
    const result = searchMentions(PATHS, 'nonexistent');
    expect(result).toEqual([]);
  });

  it('matches a directory infix', () => {
    const result = searchMentions(PATHS, 'journal');
    expect(result.map((match) => match.path)).toContain('journal/2026-05-09.md');
  });
});
