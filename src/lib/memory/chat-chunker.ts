// Role-aware chunker for chat session files (Phase 5.7).
//
// A `.chats/<session-id>.md` file is structured: frontmatter + alternating
// `## role · timestamp` blocks (see `$lib/chat/format`). The note-aware
// `chunkMarkdown` would naively split this on h2 headings — which technically
// works but throws away the role and timestamp metadata that retrieval needs
// to filter by speaker and attribute hits.
//
// This chunker:
//   - parses the file with the canonical chat parser
//   - emits one chunk per substantive message
//   - filters out short / pure-emoji / pure-punctuation messages (noise)
//   - tags each chunk with role + messageIndex + timestamp
//
// Long messages still need windowing — we delegate to `chunkMarkdown` for that
// case, preserving role tags across the windows.

import { ChatParseError, parseSession } from '$lib/chat/format';
import type { Role } from '$lib/chat/types';
import { chunkMarkdown, countTokens, type Chunk } from '$lib/embed';

export interface ChatChunkOptions {
  // Drop messages whose trimmed content has fewer than this many non-whitespace
  // characters. Default 40 — enough to skip "lol ok" / "got it" / pure emoji
  // without losing short-but-substantive observations.
  minChars?: number;
  // Token cap per chunk before windowing kicks in. Matches `chunkMarkdown`'s
  // default to keep behavior consistent across note + chat sources.
  maxTokens?: number;
  // Injected so tests don't need the real tokenizer.
  countTokens?: (text: string) => Promise<number> | number;
}

export interface ChatChunk extends Chunk {
  role: Role;
  messageIndex: number;
  messageTimestamp: number;
}

const DEFAULT_MIN_CHARS = 40;
const PURE_EMOJI_OR_PUNCT = /^[\s\p{Emoji}\p{P}\p{S}]+$/u;

export async function chunkChatSession(
  rawContent: string,
  options: ChatChunkOptions = {},
): Promise<ChatChunk[]> {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const tokenizer = options.countTokens ?? countTokens;

  let session;
  try {
    session = parseSession(rawContent);
  } catch (error: unknown) {
    if (error instanceof ChatParseError) return [];
    throw error;
  }

  const out: ChatChunk[] = [];
  let chunkIndex = 0;
  // Track the offset of each message in the raw file so retrieval can jump
  // to the spot. We don't need exact offsets — coarse approximation by
  // accumulating message-content lengths is fine for now.
  let runningOffset = 0;

  for (const [messageIndex, message] of session.messages.entries()) {
    const text = message.content.trim();
    runningOffset += text.length + 1; // +1 for the trailing newline-ish gap
    if (isNoise(text, minChars)) continue;

    const messageWindows = await chunkMarkdown(text, {
      countTokens: tokenizer,
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    });

    // `chunkMarkdown` returns an empty array for whitespace-only input — we
    // already filtered that. If a substantive message somehow produced zero
    // windows, emit a single fallback chunk so we don't drop the message.
    const windows: Chunk[] =
      messageWindows.length === 0
        ? [{ index: 0, text, start: 0, end: text.length }]
        : messageWindows;

    for (const window of windows) {
      out.push({
        index: chunkIndex,
        text: window.text,
        ...(window.heading !== undefined && { heading: window.heading }),
        start: window.start,
        end: window.end,
        role: message.role,
        messageIndex,
        messageTimestamp: message.timestamp,
      });
      chunkIndex += 1;
    }
    void runningOffset; // Reserved for future precise-offset implementation.
  }

  return out;
}

function isNoise(text: string, minChars: number): boolean {
  if (text === '') return true;
  // Count non-whitespace characters; a paragraph of mostly newlines shouldn't
  // pass the floor.
  const nonWhitespace = text.replaceAll(/\s+/g, '');
  if (nonWhitespace.length < minChars) return true;
  if (PURE_EMOJI_OR_PUNCT.test(text)) return true;
  return false;
}
