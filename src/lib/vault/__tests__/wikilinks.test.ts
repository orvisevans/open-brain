import { describe, expect, it } from 'vitest';

import { extractWikilinks } from '../wikilinks';

describe('extractWikilinks', () => {
  it('extracts a simple [[target]]', () => {
    const links = extractWikilinks('See [[other-note]] for context.', 'notes/a.md');
    expect(links).toEqual([{ from: 'notes/a.md', to: 'other-note' }]);
  });

  it('extracts [[target|display]]', () => {
    const links = extractWikilinks('Check [[target|the display]] now.', 'notes/a.md');
    expect(links).toEqual([{ from: 'notes/a.md', to: 'target', display: 'the display' }]);
  });

  it('returns multiple links in order', () => {
    const links = extractWikilinks('[[a]] then [[b|B]] and [[c]]', 'n.md');
    expect(links).toEqual([
      { from: 'n.md', to: 'a' },
      { from: 'n.md', to: 'b', display: 'B' },
      { from: 'n.md', to: 'c' },
    ]);
  });

  it('ignores wikilinks inside fenced code blocks', () => {
    const body = 'before\n\n```\n[[ignored]]\n```\n\n[[kept]] after\n';
    const links = extractWikilinks(body, 'n.md');
    expect(links).toEqual([{ from: 'n.md', to: 'kept' }]);
  });

  it('ignores wikilinks inside inline code spans', () => {
    const links = extractWikilinks('Inline `[[ignored]]` but [[kept]] yes', 'n.md');
    expect(links).toEqual([{ from: 'n.md', to: 'kept' }]);
  });

  it('drops entries with empty targets', () => {
    const links = extractWikilinks('[[]] and [[ ]] and [[real]]', 'n.md');
    expect(links).toEqual([{ from: 'n.md', to: 'real' }]);
  });

  it('does not treat a single bracket pair as a wikilink', () => {
    const links = extractWikilinks('[notlink](url)', 'n.md');
    expect(links).toEqual([]);
  });

  it('omits the display key when display is missing or empty after trimming', () => {
    const links = extractWikilinks('[[a|]] and [[b]]', 'n.md');
    expect(links).toEqual([
      { from: 'n.md', to: 'a' },
      { from: 'n.md', to: 'b' },
    ]);
  });
});
