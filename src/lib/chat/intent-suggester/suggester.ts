// Embedding-based intent suggester.
//
// Embed the user's input, cosine-score against pre-embedded exemplars per
// command (see exemplars.ts), return the top match if it crosses the
// confidence threshold. Never decides on its own — the result is fed to the
// chip bar's `promote` prop, which highlights and reorders the chip but
// does not insert anything into the input.
//
// The exemplar embeddings are computed on first use and cached for the
// page lifetime. The exemplar set is checked into source so its hash never
// changes between reloads — no IndexedDB caching layer needed for MVP.
//
// Failure mode: if the embedder isn't loaded yet (first call triggers a
// model download), or if the input embedding throws, we return undefined
// and the chip bar stays in its frecency-based default order. The user
// can still send their message; the suggester is purely additive.

import { embed } from '$lib/embed';
import { cosine } from '$lib/memory/retrieve';

import { INTENT_EXEMPLARS } from './exemplars';

export const DEFAULT_THRESHOLD = 0.55;

export interface IntentSuggestion {
  command: string;
  score: number;
}

interface ExemplarVector {
  command: string;
  exemplar: string;
  vector: Float32Array;
}

let cached: ExemplarVector[] | undefined;
let inflight: Promise<ExemplarVector[]> | undefined;

async function getExemplarVectors(): Promise<ExemplarVector[]> {
  if (cached !== undefined) return cached;
  inflight ??= (async () => {
    const out: ExemplarVector[] = [];
    for (const [command, phrases] of Object.entries(INTENT_EXEMPLARS)) {
      for (const exemplar of phrases) {
        const vector = await embed(exemplar);
        out.push({ command, exemplar, vector });
      }
    }
    cached = out;
    return out;
  })().catch((error: unknown) => {
    // On failure, clear the inflight slot so a future call can retry.
    inflight = undefined;
    throw error;
  });
  return inflight;
}

export async function suggestCommand(
  input: string,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<IntentSuggestion | undefined> {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  let queryVector: Float32Array;
  try {
    queryVector = await embed(trimmed);
  } catch {
    return undefined;
  }

  let exemplars: ExemplarVector[];
  try {
    exemplars = await getExemplarVectors();
  } catch {
    return undefined;
  }
  if (exemplars.length === 0) return undefined;

  let bestScore = 0;
  let bestCommand: string | undefined;
  for (const exemplar of exemplars) {
    const score = cosine(queryVector, exemplar.vector);
    if (score > bestScore) {
      bestScore = score;
      bestCommand = exemplar.command;
    }
  }

  if (bestCommand !== undefined && bestScore >= threshold) {
    return { command: bestCommand, score: bestScore };
  }
  return undefined;
}

// Test seam: clear the cached exemplar embeddings between tests.
export function clearSuggesterCacheForTest(): void {
  cached = undefined;
  inflight = undefined;
}
