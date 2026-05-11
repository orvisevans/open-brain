import { describe, expect, it } from 'vitest';

import { composeChatBudget, trimHistoryToBudget, type TrimmableMessage } from '../budget';

// 1 token per non-space character — simple and deterministic.
const countTokens = (text: string): number => text.replaceAll(/\s+/g, '').length;

function message(role: TrimmableMessage['role'], content: string): TrimmableMessage {
  return { role, content };
}

describe('composeChatBudget', () => {
  it('splits the window per default fractions', () => {
    const budget = composeChatBudget({ contextWindow: 8000 });
    expect(budget.systemTokens).toBe(800);
    expect(budget.retrievalTokens).toBe(4000);
    expect(budget.historyTokens).toBe(2400);
    expect(budget.responseTokens).toBe(800);
  });

  it('honours custom fractions', () => {
    const budget = composeChatBudget({
      contextWindow: 1000,
      fractions: { system: 0.2, retrieval: 0.3, history: 0.4, response: 0.1 },
    });
    expect(budget.systemTokens).toBe(200);
    expect(budget.retrievalTokens).toBe(300);
    expect(budget.historyTokens).toBe(400);
    expect(budget.responseTokens).toBe(100);
  });

  it('clamps a negative window to zero', () => {
    const budget = composeChatBudget({ contextWindow: -100 });
    expect(budget.historyTokens).toBe(0);
  });
});

describe('trimHistoryToBudget', () => {
  it('returns history unchanged when it fits', () => {
    const history = [message('user', 'hi'), message('assistant', 'hello')];
    const result = trimHistoryToBudget(history, 1000, { countTokens });
    expect(result.trimmed).toEqual(history);
    expect(result.droppedCount).toBe(0);
    expect(result.droppedTokens).toBe(0);
  });

  it('drops oldest messages first', () => {
    const history = [
      message('user', 'a'.repeat(10)),
      message('assistant', 'b'.repeat(10)),
      message('user', 'c'.repeat(10)),
      message('assistant', 'd'.repeat(10)),
      message('user', 'e'.repeat(10)),
      message('assistant', 'f'.repeat(10)),
    ];
    // Each message ≈ 14 tokens (10 chars + 4 overhead). Budget 30 = 2 messages fit.
    // minKeep default = 4, but the function honours minKeep so we don't trim
    // below 4 even if it puts us over budget.
    const result = trimHistoryToBudget(history, 30, { countTokens });
    expect(result.trimmed.length).toBe(4); // minKeep floor
    expect(result.droppedCount).toBe(2);
    expect(result.trimmed[0]?.content).toBe('c'.repeat(10));
  });

  it('returns the full history when budget is plenty', () => {
    const history = Array.from({ length: 6 }, (_, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', String(index)),
    );
    const result = trimHistoryToBudget(history, 10_000, { countTokens });
    expect(result.trimmed.length).toBe(history.length);
  });

  it('respects a custom minKeep', () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(20)),
    );
    // Each message ≈ 24 tokens. Budget 50 ≈ 2 messages. minKeep=2.
    const result = trimHistoryToBudget(history, 50, { countTokens, minKeep: 2 });
    expect(result.trimmed.length).toBe(2);
    expect(result.droppedCount).toBe(8);
  });

  it('returns droppedCount=0 when nothing was dropped', () => {
    const history = [message('user', 'short')];
    const result = trimHistoryToBudget(history, 1000, { countTokens });
    expect(result.droppedCount).toBe(0);
    expect(result.droppedTokens).toBe(0);
  });

  it('handles an empty history', () => {
    const result = trimHistoryToBudget<TrimmableMessage>([], 100, { countTokens });
    expect(result.trimmed).toEqual([]);
    expect(result.droppedCount).toBe(0);
  });

  it('handles a zero budget by stopping at minKeep', () => {
    const history = Array.from({ length: 8 }, (_, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(5)),
    );
    const result = trimHistoryToBudget(history, 0, { countTokens, minKeep: 4 });
    // Budget=0 means we'd love to drop everything, but minKeep=4 holds.
    expect(result.trimmed.length).toBe(4);
    expect(result.droppedCount).toBe(4);
  });

  it('tracks droppedTokens accurately', () => {
    const history = [
      message('user', 'x'.repeat(10)), // 14 tokens
      message('assistant', 'y'.repeat(10)), // 14 tokens
      message('user', 'z'.repeat(10)), // 14 tokens
      message('assistant', 'w'.repeat(10)), // 14 tokens
      message('user', 'v'.repeat(10)), // 14 tokens
      message('assistant', 'u'.repeat(10)), // 14 tokens
    ];
    const result = trimHistoryToBudget(history, 30, { countTokens, minKeep: 4 });
    expect(result.droppedCount).toBe(2);
    expect(result.droppedTokens).toBe(28);
  });

  it('uses custom perMessageOverhead', () => {
    const history = [
      message('user', 'a'.repeat(5)),
      message('assistant', 'b'.repeat(5)),
      message('user', 'c'.repeat(5)),
    ];
    // With overhead=0 and 5 tok/message, total = 15. Budget=10 + minKeep=2.
    const result = trimHistoryToBudget(history, 10, {
      countTokens,
      minKeep: 2,
      perMessageOverhead: 0,
    });
    expect(result.trimmed.length).toBe(2);
  });

  it('respects minKeep even when the kept tail exceeds budget', () => {
    const history = Array.from({ length: 6 }, (_, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(100)),
    );
    // 104 tokens per message, budget=10, minKeep=4. Function stops at
    // minKeep — caller takes over from here (trims retrieval, etc.).
    const result = trimHistoryToBudget(history, 10, { countTokens, minKeep: 4 });
    expect(result.trimmed.length).toBe(4);
  });
});
