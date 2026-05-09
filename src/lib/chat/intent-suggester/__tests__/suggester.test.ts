import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setEmbedderForTest } from '$lib/embed';

import { INTENT_EXEMPLARS } from '../exemplars';
import { clearSuggesterCacheForTest, suggestCommand } from '../suggester';

// Use a deterministic embedder where each text gets a vector based on which
// command's exemplars contain it as a substring of any exemplar — i.e. we
// fake a "perfectly aligned" semantic space so we can prove the suggester
// pipeline (embed → cosine → threshold) works end-to-end.
function installAlignedEmbedder(): () => void {
  const dimByCommand: Record<string, number> = {
    '/journal': 0,
    '/save': 1,
    '/note': 2,
    '/list': 3,
    '/append': 4,
  };

  function vectorFor(text: string): Float32Array {
    const lowered = text.toLowerCase();
    const vector = new Float32Array(384);
    // For each command, check if the input matches any exemplar (or is a
    // close paraphrase). For tests, we just check token overlap.
    for (const [command, phrases] of Object.entries(INTENT_EXEMPLARS)) {
      const dim = dimByCommand[command];
      if (dim === undefined) continue;
      for (const phrase of phrases) {
        const phraseLower = phrase.toLowerCase();
        if (lowered.includes(phraseLower) || phraseLower.includes(lowered)) {
          vector[dim] = 1;
          return vector;
        }
      }
    }
    // No match → all zeros (cosine with anything → 0).
    return vector;
  }

  setEmbedderForTest({
    embed: (texts) => Promise.resolve(texts.map((text) => vectorFor(text))),
    countTokens: (text) => text.split(/\s+/).length,
  });

  return () => {
    setEmbedderForTest(undefined);
  };
}

beforeEach(() => {
  clearSuggesterCacheForTest();
});

afterEach(() => {
  setEmbedderForTest(undefined);
  clearSuggesterCacheForTest();
});

describe('suggestCommand', () => {
  it('returns undefined for empty input', async () => {
    const restore = installAlignedEmbedder();
    try {
      expect(await suggestCommand('')).toBeUndefined();
      expect(await suggestCommand('   ')).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('matches a journal-flavored phrase', async () => {
    const restore = installAlignedEmbedder();
    try {
      const result = await suggestCommand('today I felt');
      expect(result?.command).toBe('/journal');
      expect(result?.score).toBeGreaterThan(0.5);
    } finally {
      restore();
    }
  });

  it('matches a list-flavored phrase', async () => {
    const restore = installAlignedEmbedder();
    try {
      const result = await suggestCommand('add eggs to my grocery list');
      expect(result?.command).toBe('/list');
    } finally {
      restore();
    }
  });

  it('returns undefined when no exemplar matches', async () => {
    const restore = installAlignedEmbedder();
    try {
      const result = await suggestCommand('this text has nothing to do with any command');
      expect(result).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('respects an explicit threshold', async () => {
    const restore = installAlignedEmbedder();
    try {
      // The aligned embedder produces cosine = 1 on a perfect match. Setting
      // a threshold > 1 makes everything fall under.
      const result = await suggestCommand('today I felt', 1.1);
      expect(result).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('returns undefined gracefully when the embedder throws', async () => {
    setEmbedderForTest({
      embed: () => Promise.reject(new Error('no embedder loaded')),
      countTokens: () => 1,
    });
    try {
      const result = await suggestCommand('today I felt');
      expect(result).toBeUndefined();
    } finally {
      setEmbedderForTest(undefined);
    }
  });
});
