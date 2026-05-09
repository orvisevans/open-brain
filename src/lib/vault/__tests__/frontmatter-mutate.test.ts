import { describe, expect, it } from 'vitest';

import { addToInlineList, setField } from '../frontmatter-mutate';

describe('setField', () => {
  it('inserts a new field when the key is missing', () => {
    const input = '---\ntype: note\n---\n\n# Title\n';
    const result = setField(input, 'archived_at', '2026-05-09T07:15:00Z');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('type: note');
    expect(result.content).toContain('archived_at: 2026-05-09T07:15:00Z');
    expect(result.content).toContain('# Title');
  });

  it('replaces an existing field value', () => {
    const input = '---\ntype: note\nfoo: old\n---\n\nbody\n';
    const result = setField(input, 'foo', 'new');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('foo: new');
    expect(result.content).not.toContain('foo: old');
  });

  it('reports changed: false when the value already matches', () => {
    const input = '---\nfoo: bar\n---\n\n';
    const result = setField(input, 'foo', 'bar');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(input);
  });

  it('creates frontmatter from scratch when the file has none', () => {
    const input = '# Just a heading\n\nsome body\n';
    const result = setField(input, 'type', 'note');
    expect(result.changed).toBe(true);
    expect(result.content).toMatch(/^---\ntype: note\n---\n\n# Just a heading/);
  });

  it('preserves unrelated lines verbatim', () => {
    const input = '---\ntype: note\ncreated_at: 2026-05-09T00:00:00Z\n---\n\nbody\n';
    const result = setField(input, 'tags', '[a, b]');
    expect(result.content).toContain('created_at: 2026-05-09T00:00:00Z');
  });
});

describe('addToInlineList', () => {
  it('creates a new inline list when the key is missing', () => {
    const input = '---\ntype: note\n---\n\nbody\n';
    const result = addToInlineList(input, 'tags', ['ideas', 'productivity']);
    expect(result.changed).toBe(true);
    expect(result.content).toContain('tags: [ideas, productivity]');
  });

  it('merges into an existing list, deduplicating', () => {
    const input = '---\ntype: note\ntags: [ideas, work]\n---\n\nbody\n';
    const result = addToInlineList(input, 'tags', ['productivity', 'ideas']);
    expect(result.changed).toBe(true);
    expect(result.content).toContain('tags: [ideas, work, productivity]');
  });

  it('reports changed: false when all values are already present', () => {
    const input = '---\ntags: [a, b]\n---\n\n';
    const result = addToInlineList(input, 'tags', ['a', 'b']);
    expect(result.changed).toBe(false);
  });

  it('skips empty values', () => {
    const input = '---\ntype: note\n---\n\nbody\n';
    const result = addToInlineList(input, 'tags', ['', '   ']);
    expect(result.changed).toBe(false);
  });

  it('creates frontmatter from scratch when the file has none', () => {
    const result = addToInlineList('plain body\n', 'tags', ['x']);
    expect(result.changed).toBe(true);
    expect(result.content.startsWith('---\ntags: [x]\n---')).toBe(true);
  });
});
