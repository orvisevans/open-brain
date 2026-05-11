import { describe, expect, it } from 'vitest';

import { approxTokens, countMessageTokens, countTextTokens } from '../tokenize';

describe('approxTokens', () => {
  it('returns ceil(length * 0.3)', () => {
    expect(approxTokens('')).toBe(0);
    expect(approxTokens('1234')).toBe(2);
    expect(approxTokens('a'.repeat(100))).toBe(30);
  });
});

describe('countTextTokens', () => {
  it('uses the heuristic when no engine is passed', async () => {
    expect(await countTextTokens('a'.repeat(100))).toBe(30);
  });

  it('uses the engine tokenizer when available', async () => {
    const engine = {
      tokenize: (text: string) => Array.from({ length: text.length }, (_, index) => index),
    };
    expect(await countTextTokens('hello', engine)).toBe(5);
  });

  it('falls back to the heuristic when the engine throws', async () => {
    const engine = {
      tokenize: (): number[] => {
        throw new Error('boom');
      },
    };
    expect(await countTextTokens('a'.repeat(100), engine)).toBe(30);
  });
});

describe('countMessageTokens', () => {
  it('adds per-message overhead for each entry', async () => {
    // 1 message × 4 chars body = 2 token heuristic. Plus 4 overhead = 6.
    const total = await countMessageTokens([{ role: 'user', content: '1234' }]);
    expect(total).toBe(6);
  });

  it('sums multiple messages', async () => {
    const total = await countMessageTokens([
      { role: 'system', content: 'a'.repeat(100) }, // 4 + 30 = 34
      { role: 'user', content: 'a'.repeat(50) }, // 4 + 15 = 19
    ]);
    expect(total).toBe(53);
  });

  it('handles empty arrays', async () => {
    expect(await countMessageTokens([])).toBe(0);
  });
});
