import { describe, expect, it } from 'vitest';

import { buildTree } from '../tree';

describe('buildTree', () => {
  it('returns empty tree for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('flat files', () => {
    expect(buildTree(['notes/a.md', 'notes/b.md'])).toEqual([
      {
        kind: 'directory',
        name: 'notes',
        children: [
          { kind: 'file', name: 'a.md', path: 'notes/a.md' },
          { kind: 'file', name: 'b.md', path: 'notes/b.md' },
        ],
      },
    ]);
  });

  it('groups nested directories', () => {
    const result = buildTree(['notes/a.md', 'notes/sub/b.md', 'notes/sub/c.md']);
    expect(result).toEqual([
      {
        kind: 'directory',
        name: 'notes',
        children: [
          {
            kind: 'directory',
            name: 'sub',
            children: [
              { kind: 'file', name: 'b.md', path: 'notes/sub/b.md' },
              { kind: 'file', name: 'c.md', path: 'notes/sub/c.md' },
            ],
          },
          { kind: 'file', name: 'a.md', path: 'notes/a.md' },
        ],
      },
    ]);
  });

  it('directories sort before files', () => {
    const result = buildTree(['x/a.md', 'b.md', 'a.md']);
    expect(result.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'directory:x',
      'file:a.md',
      'file:b.md',
    ]);
  });
});
