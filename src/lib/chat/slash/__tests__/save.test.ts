import { beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { saveHandler } from '../handlers/save';
import { parseSlashCommand, type ParsedCommand } from '../parser';

interface MakeContextOptions {
  vault?: SlashContext['vault'];
  sessionMessages?: SlashContext['sessionMessages'];
  // Set to true to omit `lastAssistantMessage` entirely. Required because
  // exactOptionalPropertyTypes forbids passing `undefined` for an optional
  // field — we must omit it from the object.
  noLastAssistant?: boolean;
}

function emptyVault(): DispatchVault {
  return {
    readRaw: () => Promise.resolve(''),
    listNotes: () => Promise.resolve([]),
  };
}

function vaultWith(notes: string[]): DispatchVault {
  return {
    readRaw: () => Promise.resolve(''),
    listNotes: () => Promise.resolve(notes),
  };
}

function makeContext(options: MakeContextOptions = {}): SlashContext {
  const fixedNow = new Date(Date.UTC(2026, 4, 9, 7, 15));
  const base: Omit<SlashContext, 'lastAssistantMessage'> = {
    vault: options.vault ?? emptyVault(),
    now: () => fixedNow,
    sourceTurnId: 'turn-1',
    sessionId: 'session-1',
    sessionMessages: options.sessionMessages ?? [
      { role: 'user', content: 'tell me about embeddings', timestamp: 1 },
      { role: 'assistant', content: 'Embeddings are vector representations…', timestamp: 2 },
    ],
  };
  if (options.noLastAssistant === true) {
    return base;
  }
  return {
    ...base,
    lastAssistantMessage: {
      id: 'm-2',
      content: 'Embeddings are vector representations…',
      timestamp: 2,
    },
  };
}

// Test helper: parse the input or fail loudly. Avoids non-null-assertions
// at every call site while keeping tests readable.
function parse(input: string): ParsedCommand {
  const result = parseSlashCommand(input);
  if (result === undefined) {
    throw new Error(`expected slash command, got undefined for: ${input}`);
  }
  return result;
}

beforeEach(() => {
  resetHandlers();
  registerHandler('save', saveHandler);
});

describe('/save dispatch', () => {
  it('produces a proposal that creates notes/<slug>.md from the assistant reply', async () => {
    const result = await dispatch(parse('/save'), makeContext());
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(result.proposal.op).toBe('create');
    expect(result.proposal.target).toMatch(/^notes\/.+\.md$/);
    expect(result.proposal.existingContent).toBe('');
    expect(result.proposal.finalContent).toContain('type: note');
    expect(result.proposal.finalContent).toContain('source_chat: .chats/session-1.md');
    expect(result.proposal.finalContent).toContain('Embeddings are vector representations');
    expect(result.proposal.finalContent).toContain('created_at: 2026-05-09T07:15:00.000Z');
  });

  it('uses an explicit title when provided', async () => {
    const result = await dispatch(parse('/save my embeddings note'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.target).toBe('notes/my-embeddings-note.md');
  });

  it('honours an explicit @target', async () => {
    const result = await dispatch(parse('/save @notes/explicit'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.target).toBe('notes/explicit.md');
  });

  it('avoids slug collisions via nextAvailableSlug', async () => {
    const context = makeContext({
      vault: vaultWith(['notes/embeddings-are-vector-representations.md']),
    });
    const result = await dispatch(parse('/save'), context);
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.target).toBe('notes/embeddings-are-vector-representations-2.md');
  });

  it('--all serializes the whole session', async () => {
    const result = await dispatch(parse('/save --all'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.note).toBeDefined();
    expect(result.proposal.finalContent).toContain('## user');
    expect(result.proposal.finalContent).toContain('tell me about embeddings');
    expect(result.proposal.finalContent).toContain('## assistant');
  });

  it('errors when there is no assistant message yet', async () => {
    const context = makeContext({
      sessionMessages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      noLastAssistant: true,
    });
    const result = await dispatch(parse('/save'), context);
    expect(result.kind).toBe('error');
  });

  it('errors when --all and the session is empty', async () => {
    const context = makeContext({ sessionMessages: [], noLastAssistant: true });
    const result = await dispatch(parse('/save --all'), context);
    expect(result.kind).toBe('error');
  });
});

describe('dispatch error paths', () => {
  it('reports unknown command', async () => {
    const result = await dispatch(parse('/blarg'), makeContext());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Unknown command');
    }
  });

  it('reports unimplemented commands when handler not registered', async () => {
    resetHandlers(); // wipe save too
    const result = await dispatch(parse('/save'), makeContext());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('not yet implemented');
    }
  });
});
