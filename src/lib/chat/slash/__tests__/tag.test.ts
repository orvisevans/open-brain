import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { tagHandler } from '../handlers/tag';
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
    now: () => new Date(),
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

beforeEach(() => {
  resetHandlers();
  registerHandler('tag', tagHandler);
});

describe('/tag', () => {
  it('errors on missing source', async () => {
    const result = await dispatch(parse('/tag @notes/missing.md ideas'), makeContext());
    expect(result.kind).toBe('error');
  });

  it('adds tags as a fresh inline list', async () => {
    const result = await dispatch(
      parse('/tag @notes/foo.md ideas productivity'),
      makeContext({ 'notes/foo.md': '---\ntype: note\n---\n\nbody\n' }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('tags: [ideas, productivity]');
  });

  it('strips leading # from tags so #foo and foo merge correctly', async () => {
    const result = await dispatch(
      parse('/tag @notes/foo.md #ideas #productivity'),
      makeContext({ 'notes/foo.md': '---\ntype: note\n---\n\nbody\n' }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('tags: [ideas, productivity]');
  });

  it('merges into existing tags, deduplicating', async () => {
    const original = '---\ntype: note\ntags: [ideas, work]\n---\n\nbody\n';
    const result = await dispatch(
      parse('/tag @notes/foo.md ideas productivity'),
      makeContext({ 'notes/foo.md': original }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('tags: [ideas, work, productivity]');
  });

  it('errors when all requested tags are already present', async () => {
    const original = '---\ntags: [a, b]\n---\n\n';
    const result = await dispatch(
      parse('/tag @notes/foo.md a b'),
      makeContext({ 'notes/foo.md': original }),
    );
    expect(result.kind).toBe('error');
  });
});
