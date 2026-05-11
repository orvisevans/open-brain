import { describe, expect, it } from 'vitest';

import { chunkChatSession } from '../chat-chunker';

// 1 token ≈ 1 word, sufficient for chunk-boundary tests without the real
// tokenizer.
const fakeCountTokens = (text: string): number => text.split(/\s+/).filter(Boolean).length;

function buildSession(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
): string {
  const front = [
    '---',
    'schema_version: 1',
    'session_id: test',
    'started_at: 1700000000000',
    'last_updated_at: 1700000005000',
    '---',
    '',
  ].join('\n');
  const body = messages
    .map(
      (message, index) =>
        `## ${message.role} · 2026-05-11 0${String(index)}:00\n\n${message.content}\n`,
    )
    .join('\n');
  return `${front}\n${body}`;
}

describe('chunkChatSession', () => {
  it('returns one chunk per substantive message with role + index', async () => {
    const raw = buildSession([
      {
        role: 'user',
        content:
          'I spent the afternoon reading about retrieval augmented generation patterns and embedding strategies.',
      },
      {
        role: 'assistant',
        content:
          'That is a meaty topic. RAG patterns vary across hybrid search, reranking, and pure vector lookups, each with tradeoffs.',
      },
    ]);

    const chunks = await chunkChatSession(raw, { countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.role).toBe('user');
    expect(chunks[0]?.messageIndex).toBe(0);
    expect(chunks[1]?.role).toBe('assistant');
    expect(chunks[1]?.messageIndex).toBe(1);
  });

  it('drops messages shorter than minChars', async () => {
    const raw = buildSession([
      { role: 'user', content: 'ok' },
      { role: 'user', content: 'thanks!' },
      {
        role: 'user',
        content:
          'Big idea here: capturing thoughts in chat is genuinely lower friction than journaling.',
      },
    ]);
    const chunks = await chunkChatSession(raw, { countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('lower friction');
  });

  it('drops pure-emoji and pure-punctuation turns', async () => {
    const raw = buildSession([
      { role: 'user', content: '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀' },
      { role: 'user', content: '!!!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?!?' },
      {
        role: 'user',
        content: 'Actual content that should embed because it exceeds the minimum char count.',
      },
    ]);
    const chunks = await chunkChatSession(raw, { countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(1);
  });

  it('returns empty array when the file has no frontmatter (invalid chat)', async () => {
    expect(
      await chunkChatSession('# not a chat session', { countTokens: fakeCountTokens }),
    ).toEqual([]);
  });

  it('produces sequential chunk indices across messages', async () => {
    const raw = buildSession([
      {
        role: 'user',
        content: 'First message with enough substance to clear the minimum bar handily.',
      },
      {
        role: 'user',
        content: 'Second message also long enough to be considered a substantive chunk.',
      },
      {
        role: 'user',
        content: 'Third message that is also definitely long enough to qualify as content.',
      },
    ]);
    const chunks = await chunkChatSession(raw, { countTokens: fakeCountTokens });
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('respects custom minChars threshold', async () => {
    const raw = buildSession([{ role: 'user', content: 'short but ok' }]);
    const chunks = await chunkChatSession(raw, {
      countTokens: fakeCountTokens,
      minChars: 5,
    });
    expect(chunks).toHaveLength(1);
  });
});
