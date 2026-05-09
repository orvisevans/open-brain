import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import {
  applyRelatedSection,
  configureRelatedForTest,
  relatedHandler,
  type RelatedRetriever,
} from '../handlers/related';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function vaultWith(content: Record<string, string>): DispatchVault {
  return {
    readRaw: (path) => {
      const value = content[path];
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code?: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    listNotes: () => Promise.resolve(Object.keys(content)),
  };
}

function makeContext(content: Record<string, string> = {}): SlashContext {
  return {
    vault: vaultWith(content),
    now: () => new Date(Date.UTC(2026, 4, 9, 7, 15)),
    sourceTurnId: 'turn-1',
    sessionId: 'session-1',
    sessionMessages: [],
  };
}

function parse(input: string): ParsedCommand {
  const result = parseSlashCommand(input);
  if (result === undefined) throw new Error(`expected slash command for: ${input}`);
  return result;
}

function fakeRetriever(map: Record<string, string[]>): RelatedRetriever {
  return {
    findRelated: (sourcePath, _query, topK) => {
      const matches = (map[sourcePath] ?? []).slice(0, topK);
      return Promise.resolve(matches);
    },
  };
}

beforeEach(() => {
  resetHandlers();
  configureRelatedForTest();
  registerHandler('related', relatedHandler);
});

afterEach(() => {
  configureRelatedForTest();
});

describe('/related', () => {
  it('errors on missing target', async () => {
    const result = await dispatch(parse('/related @notes/missing.md'), makeContext());
    expect(result.kind).toBe('error');
  });

  it('errors when the body is empty', async () => {
    const result = await dispatch(
      parse('/related @notes/empty.md'),
      makeContext({ 'notes/empty.md': '---\ntype: note\n---\n\n   \n' }),
    );
    expect(result.kind).toBe('error');
  });

  it('errors when no related notes are found', async () => {
    configureRelatedForTest(fakeRetriever({ 'notes/foo.md': [] }));
    const result = await dispatch(
      parse('/related @notes/foo.md'),
      makeContext({ 'notes/foo.md': '---\n---\n\nfoo body\n' }),
    );
    expect(result.kind).toBe('error');
  });

  it('proposes a See Also section listing the matches', async () => {
    configureRelatedForTest(
      fakeRetriever({
        'notes/foo.md': ['notes/bar.md', 'notes/baz.md'],
      }),
    );
    const result = await dispatch(
      parse('/related @notes/foo.md'),
      makeContext({ 'notes/foo.md': '---\n---\n\nfoo body about caching\n' }),
    );
    if (result.kind !== 'proposal') throw new Error(`expected proposal, got ${result.kind}`);
    expect(result.proposal.op).toBe('replace');
    expect(result.proposal.finalContent).toContain('## See Also');
    expect(result.proposal.finalContent).toContain('[[notes/bar.md]]');
    expect(result.proposal.finalContent).toContain('[[notes/baz.md]]');
  });

  it('replaces an existing See Also rather than duplicating', async () => {
    configureRelatedForTest(fakeRetriever({ 'notes/foo.md': ['notes/baz.md'] }));
    const existing = '---\n---\n\nfoo body\n\n## See Also\n\n- [[notes/old.md]]\n';
    const result = await dispatch(
      parse('/related @notes/foo.md'),
      makeContext({ 'notes/foo.md': existing }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('[[notes/baz.md]]');
    expect(result.proposal.finalContent).not.toContain('[[notes/old.md]]');
  });
});

describe('applyRelatedSection', () => {
  it('appends a See Also section when none exists', () => {
    const out = applyRelatedSection('# Title\n\nbody\n', ['notes/a.md', 'notes/b.md']);
    expect(out).toMatch(/## See Also[\s\S]*\[\[notes\/a\.md]][\s\S]*\[\[notes\/b\.md]]/);
  });

  it('preserves content after the See Also section when replacing', () => {
    const original = [
      '# Title',
      '',
      'body',
      '',
      '## See Also',
      '',
      '- [[notes/old.md]]',
      '',
      '## Footer',
      '',
      'footer content',
      '',
    ].join('\n');
    const out = applyRelatedSection(original, ['notes/new.md']);
    expect(out).toContain('[[notes/new.md]]');
    expect(out).not.toContain('[[notes/old.md]]');
    expect(out).toContain('## Footer');
    expect(out).toContain('footer content');
  });
});
