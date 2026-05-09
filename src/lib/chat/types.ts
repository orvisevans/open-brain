// Public types for the chat layer.

import type { NotePath } from '$lib/vault/types';

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  // For assistant turns: which notes were retrieved into the prompt. The UI
  // shows these as "based on: …" citations under the message.
  retrievedContext?: NotePath[];
}

export interface ChatSession {
  id: string;
  startedAt: number;
  lastUpdatedAt: number;
  messages: ChatMessage[];
}

export const CHAT_SCHEMA_VERSION = 1;
export const CHAT_FILE_PREFIX = '.chats/';
