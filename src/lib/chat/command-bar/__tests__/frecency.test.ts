import { describe, expect, it } from 'vitest';

import { frecencyScore, orderByFrecency, recordUse, type CommandStats } from '../frecency';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('frecencyScore', () => {
  it('returns 0 for unknown commands', () => {
    expect(frecencyScore(undefined, NOW)).toBe(0);
  });

  it('decays exponentially with age', () => {
    const recent = frecencyScore({ count: 1, lastUsedAt: NOW }, NOW);
    const day = frecencyScore({ count: 1, lastUsedAt: NOW - DAY }, NOW);
    const month = frecencyScore({ count: 1, lastUsedAt: NOW - 30 * DAY }, NOW);
    expect(recent).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(month);
  });

  it('halflife of 14 days halves the score', () => {
    const stat = { count: 4, lastUsedAt: NOW - 14 * DAY };
    expect(frecencyScore(stat, NOW)).toBeCloseTo(2, 5);
  });
});

describe('recordUse', () => {
  it('initialises a new entry', () => {
    const result = recordUse({}, '/save', NOW);
    expect(result['/save']).toEqual({ count: 1, lastUsedAt: NOW });
  });

  it('increments count and updates timestamp', () => {
    const seed: CommandStats = { '/save': { count: 3, lastUsedAt: NOW - DAY } };
    const result = recordUse(seed, '/save', NOW);
    expect(result['/save']).toEqual({ count: 4, lastUsedAt: NOW });
  });

  it('does not mutate input', () => {
    const seed: CommandStats = { '/save': { count: 1, lastUsedAt: NOW - DAY } };
    recordUse(seed, '/save', NOW);
    expect(seed['/save']?.count).toBe(1);
  });
});

describe('orderByFrecency', () => {
  it('puts most-frecent commands first', () => {
    const stats: CommandStats = {
      '/save': { count: 5, lastUsedAt: NOW },
      '/note': { count: 1, lastUsedAt: NOW - 2 * DAY },
      '/journal': { count: 10, lastUsedAt: NOW - 30 * DAY },
    };
    const result = orderByFrecency(['/save', '/note', '/journal', '/list'], stats, NOW);
    expect(result[0]).toBe('/save');
    // /list has zero score → ties with no other zero-score commands here, so
    // it lands at the end.
    expect(result.at(-1)).toBe('/list');
  });

  it('ties broken alphabetically', () => {
    const result = orderByFrecency(['/zebra', '/apple', '/mango'], {}, NOW);
    expect(result).toEqual(['/apple', '/mango', '/zebra']);
  });

  it('does not mutate input array', () => {
    const input = ['/c', '/b', '/a'];
    orderByFrecency(input, {}, NOW);
    expect(input).toEqual(['/c', '/b', '/a']);
  });

  it('recent heavy use beats month-old heavy use', () => {
    const stats: CommandStats = {
      '/recent': { count: 5, lastUsedAt: NOW },
      '/old': { count: 50, lastUsedAt: NOW - 60 * DAY },
    };
    const result = orderByFrecency(['/recent', '/old'], stats, NOW);
    expect(result[0]).toBe('/recent');
  });
});
