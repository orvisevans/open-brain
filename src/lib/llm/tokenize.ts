// Tokenisation utilities for the chat budget (Phase 5.9.1).
//
// Pure module — does NOT import WebLLM. Callers pass an optional
// `engine` shape if they have one loaded; otherwise we fall back to the
// 0.3 tok/char heuristic used elsewhere. Keeping this file engine-free
// means it can be unit-tested without WebLLM's heavyweight test setup.
//
// Per-OpenAI-style-chat-format overhead: every message carries some
// framing tokens (role tag, separators). 4 tokens/message is the
// well-worn approximation; close enough for budget arithmetic.

export interface ChatMessageLike {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CountTokensOptions {
  // Optional engine. If supplied with a `tokenize(text)` method, the
  // exact token count is used. Otherwise we fall back to the heuristic.
  engine?: TokenizableEngine;
}

const PER_MESSAGE_OVERHEAD = 4;
const FALLBACK_TOKENS_PER_CHAR = 0.3;

// A loose shape capturing the WebLLM tokenize API. We accept anything
// with the right method shape so callers don't have to import WebLLM
// types just to call us.
export interface TokenizableEngine {
  tokenize?: (text: string) => number[] | { length: number };
}

export async function countMessageTokens(
  messages: readonly ChatMessageLike[],
  options: CountTokensOptions = {},
): Promise<number> {
  let total = 0;
  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD;
    total += await countTextTokens(message.content, options.engine);
  }
  return total;
}

export async function countTextTokens(text: string, engine?: TokenizableEngine): Promise<number> {
  if (engine !== undefined && typeof engine.tokenize === 'function') {
    try {
      const tokens = await Promise.resolve(engine.tokenize(text));
      return tokens.length;
    } catch {
      // Tokenizer threw — fall through to the heuristic.
    }
  }
  return approxTokens(text);
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length * FALLBACK_TOKENS_PER_CHAR);
}
