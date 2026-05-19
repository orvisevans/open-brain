import { beforeEach, describe, expect, it } from 'vitest';

import { HELP_COMMAND_NAMES } from '$lib/llm/help-corpus';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { helpHandler } from '../handlers/help';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function emptyVault(): DispatchVault {
  return {
    readRaw: () => Promise.reject(new Error('not used')),
    listNotes: () => Promise.resolve([]),
  };
}

function makeContext(): SlashContext {
  return {
    vault: emptyVault(),
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
  registerHandler('help', helpHandler);
});

describe('/help', () => {
  it('bare /help lists every command in HELP_COMMAND_NAMES', async () => {
    const result = await dispatch(parse('/help'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind !== 'message') return;
    for (const name of HELP_COMMAND_NAMES) {
      expect(result.content).toContain(`/${name}`);
    }
    // Closing hint.
    expect(result.content).toContain('plain English');
  });

  it('/help <command> returns the matching section', async () => {
    const result = await dispatch(parse('/help journal'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind !== 'message') return;
    expect(result.content).toContain('Appends to today');
    // Does not bleed into adjacent sections.
    expect(result.content).not.toContain('## /list');
  });

  it('/help /<command> tolerates the leading slash', async () => {
    const result = await dispatch(parse('/help /save'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind !== 'message') return;
    expect(result.content).toContain('Saves the most recent assistant turn');
  });

  it('returns every command section without error', async () => {
    for (const name of HELP_COMMAND_NAMES) {
      const result = await dispatch(parse(`/help ${name}`), makeContext());
      expect(result.kind, `failed for /help ${name}`).toBe('message');
    }
  });

  it('errors on an unknown command name', async () => {
    const result = await dispatch(parse('/help blarg'), makeContext());
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('Unknown command: /blarg');
    expect(result.message).toContain('/save');
  });
});
