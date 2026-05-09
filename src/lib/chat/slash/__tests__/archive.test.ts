import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { archiveHandler } from '../handlers/archive';
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
  registerHandler('archive', archiveHandler);
});

describe('/archive', () => {
  it('errors when the source is missing', async () => {
    const result = await dispatch(parse('/archive @notes/missing.md'), makeContext());
    expect(result.kind).toBe('error');
  });

  it('proposes adding archived_at to a fresh note', async () => {
    const result = await dispatch(
      parse('/archive @notes/foo.md'),
      makeContext({ 'notes/foo.md': '---\ntype: note\n---\n\n# Title\n\nbody\n' }),
    );
    if (result.kind !== 'proposal') throw new Error(`expected proposal, got ${result.kind}`);
    expect(result.proposal.op).toBe('replace');
    expect(result.proposal.finalContent).toContain('archived_at: 2026-05-09T07:15:00.000Z');
    expect(result.proposal.finalContent).toContain('# Title');
  });

  it('errors when the note is already archived at the same timestamp', async () => {
    const original = '---\ntype: note\narchived_at: 2026-05-09T07:15:00.000Z\n---\n\nbody\n';
    const result = await dispatch(
      parse('/archive @notes/foo.md'),
      makeContext({ 'notes/foo.md': original }),
    );
    expect(result.kind).toBe('error');
  });

  it('updates archived_at if the value differs (re-archive after mutation)', async () => {
    const original = '---\ntype: note\narchived_at: 2020-01-01T00:00:00.000Z\n---\n\nbody\n';
    const result = await dispatch(
      parse('/archive @notes/foo.md'),
      makeContext({ 'notes/foo.md': original }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toContain('archived_at: 2026-05-09T07:15:00.000Z');
    expect(result.proposal.finalContent).not.toContain('2020-01-01');
  });
});
