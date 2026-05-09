import { describe, expect, it } from 'vitest';

import { parseOrganizeOutput } from '../organize';

describe('parseOrganizeOutput', () => {
  it('returns empty for NO_EXTRACTIONS', () => {
    expect(parseOrganizeOutput('NO_EXTRACTIONS')).toEqual([]);
  });

  it('returns empty for blank input', () => {
    expect(parseOrganizeOutput('')).toEqual([]);
    expect(parseOrganizeOutput('   ')).toEqual([]);
  });

  it('parses a single block', () => {
    const output = [
      'EXTRACT',
      'kind: idea',
      'title: Caching strategy',
      'excerpt: We should cache LLM outputs',
      'content:',
      'A potential approach is to hash inputs and store them locally.',
      'This avoids repeated work for the same prompt.',
      'END',
    ].join('\n');
    const result = parseOrganizeOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: 'idea',
      title: 'Caching strategy',
      excerpt: 'We should cache LLM outputs',
      content:
        'A potential approach is to hash inputs and store them locally.\nThis avoids repeated work for the same prompt.',
    });
  });

  it('parses multiple blocks', () => {
    const output = [
      'EXTRACT',
      'kind: person',
      'title: Sarah',
      'content:',
      'Met Sarah at the conference. Works on distributed systems.',
      'END',
      'EXTRACT',
      'kind: task',
      'title: Send Sarah the article',
      'content:',
      'Follow up by emailing the cosine-similarity article we discussed.',
      'END',
    ].join('\n');
    const result = parseOrganizeOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('person');
    expect(result[1]?.kind).toBe('task');
  });

  it('skips blocks missing required fields', () => {
    const output = [
      'EXTRACT',
      'kind: idea',
      // no title
      'content:',
      'something',
      'END',
      'EXTRACT',
      'kind: fact',
      'title: ok',
      'content:',
      'good content',
      'END',
    ].join('\n');
    const result = parseOrganizeOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('ok');
  });

  it('rejects unknown kinds', () => {
    const output = ['EXTRACT', 'kind: nonsense', 'title: x', 'content:', 'body', 'END'].join('\n');
    expect(parseOrganizeOutput(output)).toEqual([]);
  });

  it('drops trailing whitespace from content', () => {
    const output = ['EXTRACT', 'kind: idea', 'title: t', 'content:', 'body', '', '', 'END'].join(
      '\n',
    );
    expect(parseOrganizeOutput(output)[0]?.content).toBe('body');
  });

  it('treats an inline content value as the first content line', () => {
    const output = ['EXTRACT', 'kind: fact', 'title: t', 'content: inline', 'END'].join('\n');
    expect(parseOrganizeOutput(output)[0]?.content).toBe('inline');
  });
});
