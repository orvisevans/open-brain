import { describe, expect, it } from 'vitest';

import {
  ChatParseError,
  chatPath,
  isChatPath,
  newSessionId,
  parseSession,
  serializeSession,
} from '../format';
import type { ChatSession } from '../types';

function makeSession(): ChatSession {
  return {
    id: '2026-05-09_07-15-00-000',
    startedAt: 1_700_000_000_000,
    lastUpdatedAt: 1_700_000_005_000,
    messages: [
      {
        id: 'a',
        role: 'user',
        content: 'What is in my project notes?',
        timestamp: 1_700_000_000_000,
      },
      {
        id: 'b',
        role: 'assistant',
        content: 'Your project notes mention X and Y.',
        timestamp: 1_700_000_005_000,
        retrievedContext: ['notes/project.md', 'notes/y.md'],
      },
    ],
  };
}

describe('chat path helpers', () => {
  it('produces .chats/<id>.md', () => {
    expect(chatPath('abc')).toBe('.chats/abc.md');
  });
  it('detects chat paths', () => {
    expect(isChatPath('.chats/x.md')).toBe(true);
    expect(isChatPath('notes/x.md')).toBe(false);
  });
});

describe('newSessionId', () => {
  it('produces a filename-safe ISO-derived id', () => {
    const id = newSessionId(() => Date.UTC(2026, 4, 9, 7, 15, 0));
    expect(id).toBe('2026-05-09_07-15-00-000');
    expect(/[:.]/.test(id)).toBe(false);
  });
});

describe('serializeSession / parseSession', () => {
  it('round-trips a session with citations', () => {
    const original = makeSession();
    const round = parseSession(serializeSession(original));
    expect(round.id).toBe(original.id);
    expect(round.startedAt).toBe(original.startedAt);
    expect(round.lastUpdatedAt).toBe(original.lastUpdatedAt);
    expect(round.messages).toHaveLength(2);
    expect(round.messages[0]?.role).toBe('user');
    expect(round.messages[0]?.content).toBe('What is in my project notes?');
    expect(round.messages[1]?.role).toBe('assistant');
    expect(round.messages[1]?.content).toBe('Your project notes mention X and Y.');
    expect(round.messages[1]?.retrievedContext).toEqual(['notes/project.md', 'notes/y.md']);
  });

  it('preserves multi-line message content', () => {
    const session: ChatSession = {
      id: 's',
      startedAt: 1,
      lastUpdatedAt: 2,
      messages: [
        {
          id: 'a',
          role: 'user',
          content: 'line one\n\nline two\nline three',
          timestamp: 1,
        },
      ],
    };
    const round = parseSession(serializeSession(session));
    expect(round.messages[0]?.content).toBe('line one\n\nline two\nline three');
  });

  it('throws ChatParseError on missing frontmatter', () => {
    expect(() => parseSession('hi')).toThrow(ChatParseError);
  });

  it('throws ChatParseError on missing required field', () => {
    const bad = '---\nschema_version: 1\n---\n\n## user · 2026-05-09 07:15\nhi\n';
    expect(() => parseSession(bad)).toThrow(ChatParseError);
  });

  it('serialises an empty session', () => {
    const session: ChatSession = {
      id: 's',
      startedAt: 1,
      lastUpdatedAt: 1,
      messages: [],
    };
    const round = parseSession(serializeSession(session));
    expect(round.messages).toEqual([]);
  });
});
