import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { noteHandler } from '../handlers/note';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function emptyVault(): DispatchVault {
  return {
    readRaw: () => Promise.resolve(''),
    listNotes: () => Promise.resolve([]),
  };
}

function makeContext(vault: DispatchVault = emptyVault()): SlashContext {
  return {
    vault,
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

beforeEach(() => {
  resetHandlers();
  registerHandler('note', noteHandler);
});

describe('/note', () => {
  it('creates notes/<slug>.md with frontmatter and a heading', async () => {
    const result = await dispatch(parse('/note My new idea'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('create');
    expect(result.proposal.target).toBe('notes/my-new-idea.md');
    expect(result.proposal.finalContent).toContain('type: note');
    expect(result.proposal.finalContent).toContain('# My new idea');
  });

  it('includes body when provided', async () => {
    const result = await dispatch(parse('/note Title\nbody starts here'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('body starts here');
  });

  it('serializes inline #tags into frontmatter', async () => {
    const result = await dispatch(parse('/note Cool thought #ideas #later'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('tags: [ideas, later]');
  });

  it('avoids slug collisions', async () => {
    const vault: DispatchVault = {
      readRaw: () => Promise.resolve(''),
      listNotes: () => Promise.resolve(['notes/test-note.md']),
    };
    const result = await dispatch(parse('/note Test note'), makeContext(vault));
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.target).toBe('notes/test-note-2.md');
  });
});
