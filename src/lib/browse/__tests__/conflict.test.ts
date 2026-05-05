import { describe, expect, it } from 'vitest';

import { parseConflicts, resolveHunk } from '../conflict';

describe('parseConflicts', () => {
  it('returns no hunks for clean text', () => {
    expect(parseConflicts('hello\nworld\n')).toEqual([]);
  });

  it('parses a simple conflict block', () => {
    const text = [
      'preface',
      '<<<<<<< HEAD',
      'mine',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'after',
      '',
    ].join('\n');
    const hunks = parseConflicts(text);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.ours).toBe('mine');
    expect(hunks[0]?.theirs).toBe('theirs');
  });

  it('parses multiple hunks', () => {
    const text = [
      '<<<<<<< a',
      'A1',
      '=======',
      'A2',
      '>>>>>>> a',
      'middle',
      '<<<<<<< b',
      'B1',
      '=======',
      'B2',
      '>>>>>>> b',
      '',
    ].join('\n');
    const hunks = parseConflicts(text);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.ours).toBe('A1');
    expect(hunks[1]?.theirs).toBe('B2');
  });

  it('handles diff3 base segment by dropping it from "ours"', () => {
    const text = [
      '<<<<<<< HEAD',
      'mine',
      '||||||| base',
      'common ancestor',
      '=======',
      'theirs',
      '>>>>>>> branch',
      '',
    ].join('\n');
    const hunks = parseConflicts(text);
    expect(hunks[0]?.ours).toBe('mine');
    expect(hunks[0]?.theirs).toBe('theirs');
  });
});

describe('resolveHunk', () => {
  it('replaces the hunk with the chosen side', () => {
    const text = ['line1', '<<<<<<< a', 'mine', '=======', 'theirs', '>>>>>>> a', 'line2', ''].join(
      '\n',
    );
    const [hunk] = parseConflicts(text);
    if (hunk === undefined) throw new Error('expected one hunk');
    expect(resolveHunk(text, hunk, 'ours')).toBe('line1\nmine\nline2\n');
    expect(resolveHunk(text, hunk, 'theirs')).toBe('line1\ntheirs\nline2\n');
  });
});
