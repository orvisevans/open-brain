import { beforeEach, describe, expect, it } from 'vitest';

import type { NotePath } from '$lib/vault/types';

import { chatPath } from '../format';
import { appendMessage, listSessions, loadSession, writeSession } from '../storage';
import type { ChatVault } from '../storage';
import type { ChatMessage, ChatSession } from '../types';

class FakeChatVault implements ChatVault {
  private files = new Map<NotePath, string>();

  readRaw(path: NotePath): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      const error = new Error(`no file at ${path}`) as Error & { code: string };
      error.code = 'ENOENT';
      return Promise.reject(error);
    }
    return Promise.resolve(value);
  }
  writeNote(path: NotePath, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
  listNotes(): Promise<NotePath[]> {
    return Promise.resolve([]);
  }
  listChatPaths(): Promise<NotePath[]> {
    return Promise.resolve([...this.files.keys()].filter((path) => path.startsWith('.chats/')));
  }
}

const makeSession = (id: string, lastUpdatedAt: number): ChatSession => ({
  id,
  startedAt: lastUpdatedAt - 100,
  lastUpdatedAt,
  messages: [],
});

describe('chat storage', () => {
  let vault: FakeChatVault;
  beforeEach(() => {
    vault = new FakeChatVault();
  });

  it('writeSession + loadSession round-trip', async () => {
    const session = makeSession('s1', 100);
    await writeSession(vault, session);
    const round = await loadSession(vault, 's1');
    expect(round?.id).toBe('s1');
    expect(round?.messages).toEqual([]);
  });

  it('loadSession returns undefined for unknown ids', async () => {
    expect(await loadSession(vault, 'missing')).toBeUndefined();
  });

  it('listSessions returns sessions sorted by lastUpdatedAt desc', async () => {
    await writeSession(vault, makeSession('a', 100));
    await writeSession(vault, makeSession('b', 300));
    await writeSession(vault, makeSession('c', 200));
    const sessions = await listSessions(vault);
    expect(sessions.map((session) => session.id)).toEqual(['b', 'c', 'a']);
  });

  it('appendMessage writes the updated session and bumps lastUpdatedAt', async () => {
    let session = makeSession('s1', 100);
    await writeSession(vault, session);
    const message: ChatMessage = {
      id: 'm1',
      role: 'user',
      content: 'hi',
      timestamp: 500,
    };
    session = await appendMessage(vault, session, message);
    expect(session.lastUpdatedAt).toBe(500);
    expect(session.messages).toHaveLength(1);
    const reloaded = await loadSession(vault, 's1');
    expect(reloaded?.messages).toHaveLength(1);
    expect(reloaded?.messages[0]?.content).toBe('hi');
  });

  it('listSessions skips unparseable files', async () => {
    await writeSession(vault, makeSession('a', 100));
    // Write garbage at .chats/garbage.md.
    await vault.writeNote(chatPath('garbage'), 'not a session');
    const sessions = await listSessions(vault);
    expect(sessions.map((session) => session.id)).toEqual(['a']);
  });
});
