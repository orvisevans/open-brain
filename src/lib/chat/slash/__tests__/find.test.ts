import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { configureFind, findHandler, resetFindForTest, type FindRetriever } from '../handlers/find';
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
  resetFindForTest();
  registerHandler('find', findHandler);
});

afterEach(() => {
  resetFindForTest();
});

describe('/find', () => {
  it('errors when not configured', async () => {
    const result = await dispatch(parse('/find caching'), makeContext());
    expect(result.kind).toBe('error');
  });

  it('returns a message with the matches', async () => {
    const retriever: FindRetriever = {
      search: () =>
        Promise.resolve([
          { path: 'notes/foo.md', source: 'note' },
          { path: 'notes/bar.md', source: 'note' },
        ]),
    };
    configureFind(retriever);
    const result = await dispatch(parse('/find caching'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind === 'message') {
      expect(result.content).toContain('caching');
      expect(result.content).toContain('notes/foo.md');
      expect(result.content).toContain('notes/bar.md');
    }
  });

  it('renders chat hits with the chat glyph + role + excerpt', async () => {
    const retriever: FindRetriever = {
      search: () =>
        Promise.resolve([
          {
            path: '.chats/2026-05-11_x.md',
            source: 'chat',
            role: 'user',
            excerpt: 'I was thinking about caching strategies for retrieval.',
          },
        ]),
    };
    configureFind(retriever);
    const result = await dispatch(parse('/find caching'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind === 'message') {
      expect(result.content).toContain('💬');
      expect(result.content).toContain('.chats/2026-05-11_x.md');
      expect(result.content).toContain('user');
      expect(result.content).toContain('caching strategies');
    }
  });

  it('reports no-matches as a message', async () => {
    const retriever: FindRetriever = {
      search: () => Promise.resolve([]),
    };
    configureFind(retriever);
    const result = await dispatch(parse('/find xyz'), makeContext());
    expect(result.kind).toBe('message');
    if (result.kind === 'message') {
      expect(result.content).toContain('No matches');
    }
  });

  it('errors gracefully when the retriever throws', async () => {
    const retriever: FindRetriever = {
      search: () => Promise.reject(new Error('embedder not ready')),
    };
    configureFind(retriever);
    const result = await dispatch(parse('/find caching'), makeContext());
    expect(result.kind).toBe('error');
  });
});
