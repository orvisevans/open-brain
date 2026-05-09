// Vault-backed chat session storage.
//
// Source of truth for chat history is the user's repo, not IndexedDB. Every
// turn writes the session file back through the vault, which fans out to
// the SyncEngine just like notes do — chats land in `.chats/<session-id>.md`
// and round-trip across devices.
//
// (We considered IndexedDB-only per architecture §5; user opted to sync chats
// in Phase 5. See IMPLEMENTATION-PLAN §10 entry for 2026-05-09 chat sync.)

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

import { chatPath, ChatParseError, isChatPath, parseSession, serializeSession } from './format';
import type { ChatMessage, ChatSession } from './types';

export interface ChatVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
  listNotes(): Promise<NotePath[]>;
  // The vault implementation also exposes a free-form list — we can't
  // re-purpose listNotes() because it's scoped to `notes/`. Production
  // callers pass a small wrapper that walks `.chats/` directly.
  listChatPaths(): Promise<NotePath[]>;
}

export async function loadSession(
  vault: ChatVault,
  sessionId: string,
): Promise<ChatSession | undefined> {
  const path = chatPath(sessionId);
  let raw: string;
  try {
    raw = await vault.readRaw(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    logError('chat/load-session-read', { sessionId, error });
    throw error;
  }
  try {
    return parseSession(raw);
  } catch (error: unknown) {
    if (error instanceof ChatParseError) {
      logError('chat/load-session-parse', { sessionId, message: error.message });
      return undefined;
    }
    throw error;
  }
}

export async function listSessions(vault: ChatVault): Promise<ChatSession[]> {
  const paths = await vault.listChatPaths();
  const sessions: ChatSession[] = [];
  for (const path of paths) {
    if (!isChatPath(path)) continue;
    let raw: string;
    try {
      raw = await vault.readRaw(path);
    } catch (error: unknown) {
      if (isNotFound(error)) continue;
      logError('chat/list-sessions-read', { path, error });
      continue;
    }
    try {
      sessions.push(parseSession(raw));
    } catch (error: unknown) {
      if (error instanceof ChatParseError) {
        logError('chat/list-sessions-parse', { path, message: error.message });
        continue;
      }
      throw error;
    }
  }
  // Most recent first.
  sessions.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  return sessions;
}

export async function writeSession(vault: ChatVault, session: ChatSession): Promise<void> {
  await vault.writeNote(chatPath(session.id), serializeSession(session));
}

export async function appendMessage(
  vault: ChatVault,
  session: ChatSession,
  message: ChatMessage,
): Promise<ChatSession> {
  const updated: ChatSession = {
    ...session,
    lastUpdatedAt: message.timestamp,
    messages: [...session.messages, message],
  };
  await writeSession(vault, updated);
  return updated;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
