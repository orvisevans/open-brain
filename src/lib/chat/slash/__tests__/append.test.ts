import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { appendHandler } from '../handlers/append';
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

beforeEach(() => {
  resetHandlers();
  registerHandler('append', appendHandler);
});

describe('/append', () => {
  it('appends a paragraph to an existing note', async () => {
    const result = await dispatch(
      parse('/append @notes/foo new paragraph'),
      makeContext({ 'notes/foo.md': '# Foo\n\nfirst paragraph\n' }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('append');
    expect(result.proposal.target).toBe('notes/foo.md');
    expect(result.proposal.finalContent).toContain('first paragraph');
    expect(result.proposal.finalContent).toContain('new paragraph');
  });

  it('--bullet appends as a markdown bullet', async () => {
    const result = await dispatch(
      parse('/append @notes/list --bullet milk'),
      makeContext({ 'notes/list.md': '## Items\n\n- eggs\n' }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toMatch(/- milk/);
  });

  it('proposes creating the file when the target is missing', async () => {
    const result = await dispatch(parse('/append @notes/new content'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('create');
    expect(result.proposal.target).toBe('notes/new.md');
  });

  it('errors when body is empty', async () => {
    const cmd: ParsedCommand = { kind: 'append', target: 'notes/foo.md', body: '', bullet: false };
    const result = await dispatch(cmd, makeContext());
    expect(result.kind).toBe('error');
  });
});
