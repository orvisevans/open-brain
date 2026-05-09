import { describe, expect, it } from 'vitest';

import { chunkMarkdown } from '../chunk';

// 1 word ≈ 1 token in this fake tokenizer. Keeps tests deterministic without
// pulling in the real ONNX tokenizer.
function fakeCountTokens(text: string): number {
  if (text === '') return 0;
  return text.split(/\s+/).filter((word) => word !== '').length;
}

describe('chunkMarkdown', () => {
  it('returns a single chunk for a body shorter than maxTokens', async () => {
    const body = 'Hello world.\n\nA tiny note.';
    const chunks = await chunkMarkdown(body, { maxTokens: 50, countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('Hello world.\n\nA tiny note.');
    expect(chunks[0]?.heading).toBeUndefined();
    expect(chunks[0]?.index).toBe(0);
  });

  it('splits on `##` headings', async () => {
    const body = [
      'Intro paragraph.',
      '',
      '## Section A',
      '',
      'Content of A.',
      '',
      '## Section B',
      '',
      'Content of B.',
    ].join('\n');
    const chunks = await chunkMarkdown(body, { maxTokens: 50, countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.heading).toBeUndefined();
    expect(chunks[0]?.text).toBe('Intro paragraph.');
    expect(chunks[1]?.heading).toBe('Section A');
    expect(chunks[1]?.text).toContain('Content of A.');
    expect(chunks[2]?.heading).toBe('Section B');
    expect(chunks[2]?.text).toContain('Content of B.');
  });

  it('drops the empty pre-h2 section when the body starts with a heading', async () => {
    const body = '## Only Section\n\nBody text.';
    const chunks = await chunkMarkdown(body, { maxTokens: 50, countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('Only Section');
  });

  it('falls back to token-bounded windows for oversized sections', async () => {
    const big = Array.from({ length: 60 }, (_, index) => `word${String(index)}`).join(' ');
    const body = `## Big\n\n${big}`;
    const chunks = await chunkMarkdown(body, { maxTokens: 25, countTokens: fakeCountTokens });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe('Big');
      expect(fakeCountTokens(chunk.text)).toBeLessThanOrEqual(50);
    }
  });

  it('keeps the heading prefix on every sub-window', async () => {
    const para1 = Array.from({ length: 30 }, (_, index) => `alpha${String(index)}`).join(' ');
    const para2 = Array.from({ length: 30 }, (_, index) => `beta${String(index)}`).join(' ');
    const body = `## Long\n\n${para1}\n\n${para2}`;
    const chunks = await chunkMarkdown(body, { maxTokens: 35, countTokens: fakeCountTokens });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('Long\n\n')).toBe(true);
    }
  });

  it('returns empty array for empty input', async () => {
    const chunks = await chunkMarkdown('', { maxTokens: 50, countTokens: fakeCountTokens });
    expect(chunks).toHaveLength(0);
  });

  it('numbers chunks sequentially regardless of source structure', async () => {
    const body = ['## A', 'a-text.', '', '## B', 'b-text.', '', '## C', 'c-text.'].join('\n');
    const chunks = await chunkMarkdown(body, { maxTokens: 50, countTokens: fakeCountTokens });
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});
