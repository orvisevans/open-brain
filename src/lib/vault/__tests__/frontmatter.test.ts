import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
  it('returns empty frontmatter when none present', () => {
    const result = parseFrontmatter('# Heading\n\nbody text\n');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('# Heading\n\nbody text\n');
  });

  it('extracts flat key:value pairs', () => {
    const input = '---\ntitle: Hello\ncount: 3\nflag: true\n---\nBody\n';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ title: 'Hello', count: 3, flag: true });
    expect(result.body).toBe('Body\n');
  });

  it('parses inline lists', () => {
    const input = '---\ntags: [a, b, c]\n---\nx';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('strips matching surrounding quotes from string values', () => {
    const input = `---\ntitle: "Quoted"\nother: 'single'\n---\n`;
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ title: 'Quoted', other: 'single' });
  });

  it('handles list items with quoted commas', () => {
    const input = '---\nitems: ["a, b", c]\n---\n';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ items: ['a, b', 'c'] });
  });

  it('coerces null/~ to undefined and parses floats', () => {
    const input = '---\nx: null\ny: 1.5\nz: ~\n---\n';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ x: undefined, y: 1.5, z: undefined });
  });

  it('handles empty list', () => {
    const result = parseFrontmatter('---\nitems: []\n---\n');
    expect(result.frontmatter).toEqual({ items: [] });
  });

  it('preserves the body verbatim', () => {
    const input = '---\nk: v\n---\n# H1\n\n- item\n';
    const result = parseFrontmatter(input);
    expect(result.body).toBe('# H1\n\n- item\n');
  });

  it('skips comment lines and blank lines inside the block', () => {
    const input = '---\n# comment\n\nkey: val\n---\nbody';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ key: 'val' });
  });
});
