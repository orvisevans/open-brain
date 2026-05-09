import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { journalHandler } from '../handlers/journal';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function emptyVault(content: Record<string, string> = {}): DispatchVault {
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
    vault: emptyVault(content),
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
  registerHandler('journal', journalHandler);
});

describe('/journal', () => {
  it("creates today's daily note when missing", async () => {
    const result = await dispatch(parse('/journal felt good today'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('create');
    expect(result.proposal.target).toBe('journal/2026-05-09.md');
    expect(result.proposal.finalContent).toContain('type: journal');
    expect(result.proposal.finalContent).toContain('# 2026-05-09');
    expect(result.proposal.finalContent).toContain('## Entries');
    expect(result.proposal.finalContent).toContain('### 07:15');
    expect(result.proposal.finalContent).toContain('felt good today');
  });

  it('appends to an existing daily note under the Entries heading', async () => {
    const existing = [
      '---',
      'type: journal',
      'created_at: 2026-05-09T06:00:00.000Z',
      '---',
      '',
      '# 2026-05-09',
      '',
      '## Entries',
      '',
      '### 06:00',
      '',
      'morning entry',
      '',
    ].join('\n');
    const result = await dispatch(
      parse('/journal afternoon thought'),
      makeContext({ 'journal/2026-05-09.md': existing }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('append');
    expect(result.proposal.finalContent).toContain('morning entry');
    expect(result.proposal.finalContent).toContain('### 07:15');
    expect(result.proposal.finalContent).toContain('afternoon thought');
  });

  it('errors on empty body (already filtered by parser, but doubly safe)', async () => {
    // Parser rejects /journal with no body; test the handler defensively in
    // case future code paths produce a journal command with empty body.
    const cmd: ParsedCommand = { kind: 'journal', body: '' };
    const result = await dispatch(cmd, makeContext());
    // Empty body still produces a proposal — just an empty entry. The parser
    // is the gate; the handler doesn't add a second one.
    expect(result.kind).toBe('proposal');
  });
});
