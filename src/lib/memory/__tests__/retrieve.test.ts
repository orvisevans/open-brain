import { describe, expect, it } from 'vitest';

import { assembleContext, cosine, retrieve, SYSTEM_PROMPT } from '../retrieve';
import { serializeSidecar } from '../sidecar-format';
import type { Sidecar } from '../types';
import { SIDECAR_SCHEMA_VERSION } from '../types';

import { FakeVault } from './fakes';

function vec(values: number[]): Float32Array {
  // L2-normalise so cosine reduces to dot product (matches production).
  let mag = 0;
  for (const v of values) mag += v * v;
  const norm = mag === 0 ? 1 : Math.sqrt(mag);
  const out = new Float32Array(values.length);
  for (const [index, value] of values.entries()) {
    out[index] = value / norm;
  }
  return out;
}

function makeSidecar(path: string, chunks: { text: string; vector: Float32Array }[]): Sidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    source: path,
    sourceHash: 'h',
    extractedAt: 1,
    embeddingModel: 'test',
    embeddings: chunks.map((chunk, index) => ({
      index,
      text: chunk.text,
      vector: chunk.vector,
      start: 0,
      end: chunk.text.length,
    })),
  };
}

function setRoles(sidecar: Sidecar, roles: ('user' | 'assistant' | 'system')[]): void {
  for (const [index, role] of roles.entries()) {
    const chunk = sidecar.embeddings[index];
    if (chunk === undefined) throw new Error(`no chunk at index ${String(index)}`);
    chunk.role = role;
  }
}

function setMessageIndices(sidecar: Sidecar, indices: number[]): void {
  for (const [index, messageIndex] of indices.entries()) {
    const chunk = sidecar.embeddings[index];
    if (chunk === undefined) throw new Error(`no chunk at index ${String(index)}`);
    chunk.messageIndex = messageIndex;
  }
}

class TestVault extends FakeVault {
  paths: string[] = [];
  chats: string[] = [];
  seedNote(path: string): void {
    this.setNote(path, 'irrelevant');
    if (!this.paths.includes(path)) this.paths.push(path);
  }
  seedChat(path: string): void {
    this.setNote(path, 'irrelevant');
    if (!this.chats.includes(path)) this.chats.push(path);
  }
  listNotes(): Promise<string[]> {
    return Promise.resolve([...this.paths]);
  }
  listChats(): Promise<string[]> {
    return Promise.resolve([...this.chats]);
  }
}

function buildChatVault(): TestVault {
  const vault = new TestVault();
  vault.seedChat('.chats/current.md');
  vault.seedChat('.chats/other.md');
  vault.seedNote('notes/note.md');

  const currentChat = makeSidecar('.chats/current.md', [
    { text: 'turn 0 content', vector: vec([1, 0, 0]) },
    { text: 'turn 1 content', vector: vec([1, 0, 0]) },
    { text: 'turn 2 content', vector: vec([1, 0, 0]) },
    { text: 'turn 3 content', vector: vec([1, 0, 0]) },
  ]);
  setRoles(currentChat, ['user', 'user', 'user', 'user']);
  setMessageIndices(currentChat, [0, 1, 2, 3]);
  vault.setSidecar('.memory/.chats/current.md', serializeSidecar(currentChat));

  const otherChat = makeSidecar('.chats/other.md', [
    { text: 'other-session turn 0', vector: vec([1, 0, 0]) },
  ]);
  setRoles(otherChat, ['user']);
  setMessageIndices(otherChat, [0]);
  vault.setSidecar('.memory/.chats/other.md', serializeSidecar(otherChat));

  const note = makeSidecar('notes/note.md', [{ text: 'note content', vector: vec([1, 0, 0]) }]);
  vault.setSidecar('.memory/notes/note.md', serializeSidecar(note));

  return vault;
}

describe('cosine', () => {
  it('returns 1 for identical normalised vectors', () => {
    const a = vec([1, 0, 0]);
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine(vec([1, 0]), vec([0, 1]))).toBeCloseTo(0, 5);
  });

  it('returns 0 for zero magnitude', () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosine(new Float32Array([1]), new Float32Array([1, 0]))).toBe(0);
  });
});

function buildVault(): TestVault {
  const vault = new TestVault();
  vault.seedNote('notes/a.md');
  vault.seedNote('notes/b.md');
  vault.seedNote('notes/c.md');
  vault.setSidecar(
    '.memory/notes/a.md',
    serializeSidecar(
      makeSidecar('notes/a.md', [
        { text: 'apple pie recipe', vector: vec([1, 0, 0]) },
        { text: 'cake frosting tips', vector: vec([0, 1, 0]) },
      ]),
    ),
  );
  vault.setSidecar(
    '.memory/notes/b.md',
    serializeSidecar(
      makeSidecar('notes/b.md', [{ text: 'banana bread variations', vector: vec([0.9, 0.4, 0]) }]),
    ),
  );
  // Notes c.md has no sidecar → silently skipped.
  return vault;
}

describe('retrieve', () => {
  it('returns empty result for an empty query', async () => {
    const vault = buildVault();
    const result = await retrieve(vault, '', { embedQuery: () => Promise.resolve(vec([1, 0, 0])) });
    expect(result.chunks).toEqual([]);
    expect(result.noteRefs).toEqual([]);
  });

  it('ranks chunks by cosine similarity to the query', async () => {
    const vault = buildVault();
    const result = await retrieve(vault, 'apple', {
      k: 3,
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0]?.notePath).toBe('notes/a.md');
    expect(result.chunks[0]?.text).toBe('apple pie recipe');
    expect(result.chunks[0]?.score).toBeCloseTo(1, 5);
    // banana (0.9, 0.4, 0) should rank above cake (0, 1, 0) for query [1,0,0].
    expect(result.chunks[1]?.notePath).toBe('notes/b.md');
    expect(result.chunks[2]?.notePath).toBe('notes/a.md');
  });

  it('respects k', async () => {
    const vault = buildVault();
    const result = await retrieve(vault, 'apple', {
      k: 1,
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.chunks).toHaveLength(1);
  });

  it('returns distinct noteRefs in score-rank order', async () => {
    const vault = buildVault();
    const result = await retrieve(vault, 'apple', {
      k: 5,
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.noteRefs).toEqual(['notes/a.md', 'notes/b.md']);
  });

  it('retrieves over chats alongside notes (Phase 5.7)', async () => {
    const vault = new TestVault();
    vault.seedNote('notes/a.md');
    vault.seedChat('.chats/2026-05-11_x.md');
    vault.setSidecar(
      '.memory/notes/a.md',
      serializeSidecar(makeSidecar('notes/a.md', [{ text: 'note body', vector: vec([1, 0, 0]) }])),
    );
    const chatSidecar = makeSidecar('.chats/2026-05-11_x.md', [
      { text: 'I thought about apples a lot today', vector: vec([1, 0, 0]) },
    ]);
    // Tag as a user chat chunk so the retrieval picks it up by default.
    const chunk0 = chatSidecar.embeddings[0];
    if (chunk0 === undefined) throw new Error('expected seeded chunk');
    chunk0.role = 'user';
    chunk0.messageIndex = 0;
    chunk0.messageTimestamp = 1_700_000_000_000;
    vault.setSidecar('.memory/.chats/2026-05-11_x.md', serializeSidecar(chatSidecar));

    const result = await retrieve(vault, 'apple', {
      k: 5,
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.chunks.map((c) => c.source)).toEqual(['note', 'chat']);
    // Note score 1.0; chat score 1.0 * 0.7 = 0.7 → note ranks first.
    expect(result.chunks[0]?.score).toBeCloseTo(1, 5);
    expect(result.chunks[1]?.score).toBeCloseTo(0.7, 5);
    expect(result.chunks[1]?.role).toBe('user');
    expect(result.chunks[1]?.messageIndex).toBe(0);
  });

  it('excludes assistant turns from chat retrieval by default', async () => {
    const vault = new TestVault();
    vault.seedChat('.chats/x.md');
    const chatSidecar = makeSidecar('.chats/x.md', [
      { text: 'user msg', vector: vec([1, 0, 0]) },
      { text: 'assistant msg', vector: vec([1, 0, 0]) },
    ]);
    setRoles(chatSidecar, ['user', 'assistant']);
    vault.setSidecar('.memory/.chats/x.md', serializeSidecar(chatSidecar));

    const result = await retrieve(vault, 'msg', {
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.role).toBe('user');
  });

  it('includes assistant turns when opted in', async () => {
    const vault = new TestVault();
    vault.seedChat('.chats/x.md');
    const chatSidecar = makeSidecar('.chats/x.md', [
      { text: 'user msg', vector: vec([1, 0, 0]) },
      { text: 'assistant msg', vector: vec([1, 0, 0]) },
    ]);
    setRoles(chatSidecar, ['user', 'assistant']);
    vault.setSidecar('.memory/.chats/x.md', serializeSidecar(chatSidecar));

    const result = await retrieve(vault, 'msg', {
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
      includeAssistantTurns: true,
    });
    expect(result.chunks).toHaveLength(2);
  });

  it('honours includeChats=false (notes-only retrieval)', async () => {
    const vault = new TestVault();
    vault.seedNote('notes/a.md');
    vault.seedChat('.chats/x.md');
    vault.setSidecar(
      '.memory/notes/a.md',
      serializeSidecar(makeSidecar('notes/a.md', [{ text: 'note', vector: vec([1, 0, 0]) }])),
    );
    const chatSidecar = makeSidecar('.chats/x.md', [{ text: 'chat', vector: vec([1, 0, 0]) }]);
    setRoles(chatSidecar, ['user']);
    vault.setSidecar('.memory/.chats/x.md', serializeSidecar(chatSidecar));

    const result = await retrieve(vault, 'q', {
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
      includeChats: false,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.source).toBe('note');
  });

  it('skips sidecars whose vector dimensions do not match', async () => {
    const vault = new TestVault();
    vault.seedNote('notes/a.md');
    vault.setSidecar(
      '.memory/notes/a.md',
      serializeSidecar(
        makeSidecar('notes/a.md', [
          // 3-dim chunk
          { text: 'apple', vector: vec([1, 0, 0]) },
          // 2-dim chunk (mismatched)
          { text: 'banana', vector: vec([1, 0]) },
        ]),
      ),
    );
    const result = await retrieve(vault, 'apple', {
      k: 5,
      embedQuery: () => Promise.resolve(vec([1, 0, 0])),
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.text).toBe('apple');
  });

  // ── Phase 5.9.2 (B1): RetrievalFilter ──────────────────────────────────
  describe('filter (B1: drop chunks already in live history)', () => {
    it('drops chunks from the current session whose messageIndex is live', async () => {
      const vault = buildChatVault();
      const result = await retrieve(vault, 'q', {
        k: 10,
        embedQuery: () => Promise.resolve(vec([1, 0, 0])),
        filter: {
          chatPath: '.chats/current.md',
          liveMessageIndices: new Set([2, 3]),
        },
      });
      const currentPaths = result.chunks
        .filter((c) => c.notePath === '.chats/current.md')
        .map((c) => c.messageIndex);
      // Turns 2 and 3 were in live history — dropped.
      expect(currentPaths).not.toContain(2);
      expect(currentPaths).not.toContain(3);
      // Turns 0 and 1 aged out via sliding-window trim — still retrievable.
      expect(currentPaths).toContain(0);
      expect(currentPaths).toContain(1);
    });

    it('keeps chunks from a DIFFERENT chat session even when message indices overlap', async () => {
      const vault = buildChatVault();
      const result = await retrieve(vault, 'q', {
        k: 10,
        embedQuery: () => Promise.resolve(vec([1, 0, 0])),
        filter: {
          chatPath: '.chats/current.md',
          // 0 is a live index in the CURRENT session — should not affect other.md.
          liveMessageIndices: new Set([0, 1, 2, 3]),
        },
      });
      const otherChunks = result.chunks.filter((c) => c.notePath === '.chats/other.md');
      expect(otherChunks).toHaveLength(1);
      expect(otherChunks[0]?.messageIndex).toBe(0);
    });

    it('never drops note chunks regardless of filter', async () => {
      const vault = buildChatVault();
      const result = await retrieve(vault, 'q', {
        k: 10,
        embedQuery: () => Promise.resolve(vec([1, 0, 0])),
        filter: {
          chatPath: '.chats/current.md',
          liveMessageIndices: new Set([0, 1, 2, 3]),
        },
      });
      const noteChunks = result.chunks.filter((c) => c.source === 'note');
      expect(noteChunks).toHaveLength(1);
      expect(noteChunks[0]?.notePath).toBe('notes/note.md');
    });

    it('with no filter, returns all chat chunks (current behaviour preserved)', async () => {
      const vault = buildChatVault();
      const result = await retrieve(vault, 'q', {
        k: 10,
        embedQuery: () => Promise.resolve(vec([1, 0, 0])),
      });
      const currentChunks = result.chunks.filter((c) => c.notePath === '.chats/current.md');
      expect(currentChunks).toHaveLength(4);
    });

    it('empty liveMessageIndices is a no-op (zero live, drop nothing)', async () => {
      const vault = buildChatVault();
      const result = await retrieve(vault, 'q', {
        k: 10,
        embedQuery: () => Promise.resolve(vec([1, 0, 0])),
        filter: {
          chatPath: '.chats/current.md',
          liveMessageIndices: new Set<number>(),
        },
      });
      const currentChunks = result.chunks.filter((c) => c.notePath === '.chats/current.md');
      expect(currentChunks).toHaveLength(4);
    });
  });
});

describe('assembleContext', () => {
  it('packs all chunks when under budget', () => {
    const result = {
      query: 'what is X?',
      chunks: [
        {
          notePath: 'notes/a.md',
          chunkIndex: 0,
          text: 'short',
          heading: 'Intro',
          score: 0.9,
        },
        { notePath: 'notes/b.md', chunkIndex: 0, text: 'tiny', score: 0.7 },
      ],
      noteRefs: ['notes/a.md', 'notes/b.md'],
    };
    const assembled = assembleContext(result, { contextWindow: 1000, retrievalFraction: 0.7 });
    expect(assembled.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(assembled.includedChunks).toHaveLength(2);
    expect(assembled.droppedChunks).toHaveLength(0);
    expect(assembled.userPrompt).toContain('User question: what is X?');
    expect(assembled.userPrompt).toContain('[notes/a.md (Intro)]');
    expect(assembled.userPrompt).toContain('[notes/b.md]');
  });

  it('returns the bare query when no chunks were retrieved', () => {
    const assembled = assembleContext({ query: 'hello', chunks: [], noteRefs: [] });
    expect(assembled.userPrompt).toBe('hello');
    expect(assembled.includedChunks).toEqual([]);
  });

  it('drops lowest-ranked chunks first when over budget', () => {
    const result = {
      query: 'q',
      chunks: [
        {
          notePath: 'notes/a.md',
          chunkIndex: 0,
          text: 'A'.repeat(100),
          score: 0.9,
        },
        {
          notePath: 'notes/b.md',
          chunkIndex: 0,
          text: 'B'.repeat(100),
          score: 0.8,
        },
        {
          notePath: 'notes/c.md',
          chunkIndex: 0,
          text: 'C'.repeat(100),
          score: 0.7,
        },
      ],
      noteRefs: ['notes/a.md', 'notes/b.md', 'notes/c.md'],
    };
    // Use a tiny budget so only the first chunk fits.
    const assembled = assembleContext(result, {
      contextWindow: 100,
      retrievalFraction: 0.5,
      countTokens: (text) => text.length,
    });
    expect(assembled.includedChunks).toHaveLength(1);
    expect(assembled.includedChunks[0]?.notePath).toBe('notes/a.md');
    expect(assembled.droppedChunks).toHaveLength(2);
    expect(assembled.droppedChunks[0]?.notePath).toBe('notes/b.md');
  });

  it('always keeps at least one chunk even if it exceeds the budget', () => {
    // First chunk alone is over budget. We keep it (better than no context).
    const result = {
      query: 'q',
      chunks: [
        {
          notePath: 'notes/a.md',
          chunkIndex: 0,
          text: 'A'.repeat(1000),
          score: 0.9,
        },
        {
          notePath: 'notes/b.md',
          chunkIndex: 0,
          text: 'B',
          score: 0.8,
        },
      ],
      noteRefs: ['notes/a.md', 'notes/b.md'],
    };
    const assembled = assembleContext(result, {
      contextWindow: 100,
      retrievalFraction: 0.5,
      countTokens: (text) => text.length,
    });
    expect(assembled.includedChunks).toHaveLength(1);
    expect(assembled.includedChunks[0]?.notePath).toBe('notes/a.md');
  });
});
