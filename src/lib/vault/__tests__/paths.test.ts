import { describe, expect, it } from 'vitest';

import { dailyNotePath, listPath, nextAvailableSlug, notePath, slugify } from '../paths';

describe('dailyNotePath', () => {
  it('formats UTC date as journal/YYYY-MM-DD.md', () => {
    expect(dailyNotePath(new Date(Date.UTC(2026, 4, 9, 7, 15)))).toBe('journal/2026-05-09.md');
  });
  it('zero-pads single-digit months and days', () => {
    expect(dailyNotePath(new Date(Date.UTC(2026, 0, 3)))).toBe('journal/2026-01-03.md');
  });
  it('uses UTC, not local time', () => {
    // 23:30 UTC on the 9th is the 9th regardless of local time zone.
    const utc = new Date(Date.UTC(2026, 4, 9, 23, 30));
    expect(dailyNotePath(utc)).toBe('journal/2026-05-09.md');
  });
});

describe('listPath / notePath', () => {
  it('listPath slugifies the name', () => {
    expect(listPath('Grocery List')).toBe('lists/grocery-list.md');
  });
  it('notePath does not re-slugify (caller is responsible)', () => {
    expect(notePath('already-a-slug')).toBe('notes/already-a-slug.md');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('strips diacritics', () => {
    expect(slugify('café au lait')).toBe('cafe-au-lait');
    expect(slugify('über alles')).toBe('uber-alles');
  });
  it('collapses runs of non-alphanumerics', () => {
    expect(slugify('foo!!!bar...baz')).toBe('foo-bar-baz');
  });
  it('trims leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
  });
  it('returns untitled for empty input', () => {
    expect(slugify('')).toBe('untitled');
  });
  it('returns untitled for whitespace-only input', () => {
    expect(slugify('   \t\n')).toBe('untitled');
  });
  it('returns untitled for non-Latin-only input (known MVP limitation)', () => {
    expect(slugify('日本語')).toBe('untitled');
  });
  it('truncates to 80 chars at the last hyphen above 40', () => {
    const long = 'a-'.repeat(60); // 120 chars, hyphenated every other
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('does not truncate at a hyphen if it would lose too much', () => {
    const slug = slugify(`${'x'.repeat(75)}-${'y'.repeat(20)}`);
    expect(slug.length).toBeLessThanOrEqual(80);
  });
});

describe('nextAvailableSlug', () => {
  it('returns the slug unchanged when free', () => {
    expect(nextAvailableSlug('foo', () => false)).toBe('foo');
  });
  it('appends -2 on first collision', () => {
    expect(nextAvailableSlug('foo', (slug) => slug === 'foo')).toBe('foo-2');
  });
  it('appends -3 when -2 is also taken', () => {
    expect(nextAvailableSlug('foo', (slug) => slug === 'foo' || slug === 'foo-2')).toBe('foo-3');
  });
  it('walks up to find the first free slug', () => {
    const taken = new Set(['foo', 'foo-2', 'foo-3', 'foo-4']);
    expect(nextAvailableSlug('foo', (slug) => taken.has(slug))).toBe('foo-5');
  });
});
