// Public chat layer API.

import { logError } from '$lib/log';
import { fs as sharedFs } from '$lib/sync/git';
import type { FsLike } from '$lib/vault';
import { vault } from '$lib/vault';
import type { NotePath } from '$lib/vault/types';

import type { ChatVault } from './storage';

export type { ChatMessage, ChatSession, Role } from './types';
export { CHAT_FILE_PREFIX } from './types';
export { isChatPath, chatPath, newSessionId, parseSession, serializeSession } from './format';
export { loadSession, listSessions, writeSession, appendMessage } from './storage';

const promisesFs = sharedFs.promises as unknown as FsLike;
const CHATS_ROOT = '/repo/.chats';
const MEMORY_ROOT = '/repo/.memory';

async function listChatPaths(): Promise<NotePath[]> {
  try {
    const entries = await promisesFs.readdir(CHATS_ROOT);
    return entries.filter((entry) => entry.endsWith('.md')).map((entry) => `.chats/${entry}`);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ENOENT') return [];
    }
    logError('chat/list-chat-paths', { error });
    return [];
  }
}

// Phase 5.8: enumerate `.memory/**.suggestions.json` paths so the daily-review
// banner can count cumulative fresh suggestions across notes + chats. Walks
// the directory tree because suggestion sidecars mirror their source path
// (e.g. `.memory/.chats/<id>.md.suggestions.json`).
async function listSuggestionPaths(): Promise<NotePath[]> {
  const out: NotePath[] = [];
  async function walk(absolute: string): Promise<void> {
    let entries: string[];
    try {
      entries = await promisesFs.readdir(absolute);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue;
      const child = `${absolute}/${entry}`;
      let stats;
      try {
        stats = await promisesFs.stat(child);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        await walk(child);
      } else if (stats.isFile() && child.endsWith('.suggestions.json')) {
        out.push(child.slice('/repo/'.length));
      }
    }
  }
  try {
    await walk(MEMORY_ROOT);
  } catch (error: unknown) {
    logError('chat/list-suggestion-paths', { error });
  }
  return out;
}

// Production singleton wrapping the shared vault. We satisfy `ChatVault` by
// adding a `listChatPaths()` that walks `.chats/` directly via the shared fs
// (the standard `vault.listNotes()` is scoped to `notes/`).
export const chatVault: ChatVault & { listSuggestionPaths(): Promise<NotePath[]> } = {
  readRaw: (path) => vault.readRaw(path),
  writeNote: (path, content) => vault.writeNote(path, content),
  listNotes: () => vault.listNotes(),
  listChatPaths,
  listSuggestionPaths,
};
