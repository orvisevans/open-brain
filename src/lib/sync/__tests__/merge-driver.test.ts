import { describe, expect, it } from 'vitest';

import { diff3MergeDriver } from '../merge-driver';

const branches = ['base', 'main', 'origin/main'];

describe('diff3MergeDriver', () => {
  it('returns cleanMerge: true when neither side changed', () => {
    const result = diff3MergeDriver({
      branches,
      contents: ['hello\nworld\n', 'hello\nworld\n', 'hello\nworld\n'],
    });
    expect(result.cleanMerge).toBe(true);
    expect(result.mergedText).toBe('hello\nworld\n');
  });

  it('clean-merges non-overlapping changes from both sides', () => {
    // base has 3 lines; ours adds a line at top, theirs adds a line at bottom.
    const base = 'b\nc\nd\n';
    const ours = 'a\nb\nc\nd\n';
    const theirs = 'b\nc\nd\ne\n';
    const result = diff3MergeDriver({ branches, contents: [base, ours, theirs] });
    expect(result.cleanMerge).toBe(true);
    expect(result.mergedText).toBe('a\nb\nc\nd\ne\n');
  });

  it('produces marker output on overlapping change', () => {
    const base = 'one\nshared\nthree\n';
    const ours = 'one\nMINE\nthree\n';
    const theirs = 'one\nTHEIRS\nthree\n';
    const result = diff3MergeDriver({ branches, contents: [base, ours, theirs] });
    expect(result.cleanMerge).toBe(false);
    expect(result.mergedText).toContain('<<<<<<< main');
    expect(result.mergedText).toContain('MINE');
    expect(result.mergedText).toContain('=======');
    expect(result.mergedText).toContain('THEIRS');
    expect(result.mergedText).toContain('>>>>>>> origin/main');
  });

  it('preserves untouched lines around a conflict', () => {
    const base = 'preface\nshared\nepilogue\n';
    const ours = 'preface\nA\nepilogue\n';
    const theirs = 'preface\nB\nepilogue\n';
    const result = diff3MergeDriver({ branches, contents: [base, ours, theirs] });
    expect(result.cleanMerge).toBe(false);
    expect(result.mergedText.startsWith('preface\n')).toBe(true);
    expect(result.mergedText.endsWith('epilogue\n')).toBe(true);
  });
});
