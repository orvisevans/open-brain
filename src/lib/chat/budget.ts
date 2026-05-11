// Chat budget composer (Phase 5.9.1).
//
// Two pure functions:
//
//   composeChatBudget({ contextWindow, fractions }) → per-slot allocations
//   trimHistoryToBudget(history, currentMessage, budget, countTokens)
//     → { trimmed, droppedCount, droppedTokens }
//
// Strategy: sliding window. Drop oldest user/assistant pairs first.
// Preserve `MIN_KEEP` most recent messages (default 4) for short-range
// coreference. Never drop the current user message. Slash-command
// system-confirmation messages are filtered out upstream before this
// function sees them, so they don't enter the calculation.
//
// Dropped turns aren't lost — Phase 5.7's chat-memory layer keeps the
// full session embedded in `.memory/.chats/<id>.md.json`, so the model
// can still recall them via retrieval. We're trimming the prompt, not
// the record.

export interface ChatBudgetFractions {
  // Fraction of the context window reserved for the system prompt
  // (capabilities + persona + retrieval guardrails + slash-emit).
  system?: number;
  // Fraction reserved for retrieved chunks.
  retrieval?: number;
  // Fraction reserved for message history (turns before the current one).
  history?: number;
  // Fraction reserved for the model's response.
  response?: number;
}

export interface ChatBudgetInput {
  contextWindow: number;
  fractions?: ChatBudgetFractions;
}

export interface ChatBudget {
  systemTokens: number;
  retrievalTokens: number;
  historyTokens: number;
  responseTokens: number;
}

const DEFAULT_FRACTIONS: Required<ChatBudgetFractions> = {
  system: 0.1,
  retrieval: 0.5,
  history: 0.3,
  response: 0.1,
};

export function composeChatBudget(input: ChatBudgetInput): ChatBudget {
  const fractions = { ...DEFAULT_FRACTIONS, ...input.fractions };
  const window = Math.max(0, input.contextWindow);
  return {
    systemTokens: Math.floor(window * fractions.system),
    retrievalTokens: Math.floor(window * fractions.retrieval),
    historyTokens: Math.floor(window * fractions.history),
    responseTokens: Math.floor(window * fractions.response),
  };
}

export interface TrimmableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface TrimResult<T extends TrimmableMessage> {
  trimmed: T[];
  droppedCount: number;
  droppedTokens: number;
}

export interface TrimOptions {
  // Minimum messages from the end of history to retain (default 4 —
  // typically 2 user + 2 assistant). Lower bound; will not drop past
  // this even if it means going over budget. Caller is then responsible
  // for trimming retrieval to fit.
  minKeep?: number;
  // How to count tokens. Synchronous for simplicity — the chat-page
  // wrapper memoises with the async tokenizer and passes a sync getter.
  countTokens: (text: string) => number;
  // Per-message overhead (role tag + separators). Default 4 tokens.
  perMessageOverhead?: number;
}

const DEFAULT_MIN_KEEP = 4;
const DEFAULT_PER_MESSAGE_OVERHEAD = 4;

// Trims `history` (oldest first) until it fits within `budget` tokens.
// `currentMessage` is the user's NEW turn — it's not in `history` (the
// caller hasn't appended it yet) and is never dropped. It's included
// here only so callers can pass the same `countTokens` helper without
// special-casing it.
export function trimHistoryToBudget<T extends TrimmableMessage>(
  history: readonly T[],
  budget: number,
  options: TrimOptions,
): TrimResult<T> {
  const minKeep = options.minKeep ?? DEFAULT_MIN_KEEP;
  const perMessageOverhead = options.perMessageOverhead ?? DEFAULT_PER_MESSAGE_OVERHEAD;
  if (history.length === 0) {
    return { trimmed: [], droppedCount: 0, droppedTokens: 0 };
  }

  const tokenCount = (message: T): number =>
    options.countTokens(message.content) + perMessageOverhead;

  const counts = history.map((m) => tokenCount(m));
  const totalCount = (start: number): number =>
    counts.slice(start).reduce((sum, value) => sum + value, 0);

  // Walk from oldest forward; find the smallest start index whose tail
  // fits the budget AND whose tail length is ≥ minKeep when possible.
  let start = 0;
  let total = totalCount(0);
  while (total > budget) {
    const remaining = history.length - start;
    // Honour minKeep — stop trimming once we'd drop into it. The caller
    // takes over (trim retrieval) past this point.
    if (remaining <= minKeep) break;
    total -= counts[start] ?? 0;
    start += 1;
  }

  const dropped = history.slice(0, start);
  const trimmed = history.slice(start);
  const droppedTokens = dropped.reduce((sum, message) => sum + tokenCount(message), 0);
  return {
    trimmed,
    droppedCount: dropped.length,
    droppedTokens,
  };
}
