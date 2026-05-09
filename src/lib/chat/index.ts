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

// Production singleton wrapping the shared vault. We satisfy `ChatVault` by
// adding a `listChatPaths()` that walks `.chats/` directly via the shared fs
// (the standard `vault.listNotes()` is scoped to `notes/`).
export const chatVault: ChatVault = {
  readRaw: (path) => vault.readRaw(path),
  writeNote: (path, content) => vault.writeNote(path, content),
  listNotes: () => vault.listNotes(),
  listChatPaths,
};
