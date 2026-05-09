// Retrieval: query → top-K chunks across all sidecars + assembled prompt.
//
// Algorithm (per ARCHITECTURE-2026-04-17 §10):
//   1. Embed the query.
//   2. Load every sidecar from the vault.
//   3. Cosine-rank query against each chunk vector.
//   4. Return top-K chunks (default 5).
//   5. `assembleContext` formats them into the prompt the LLM consumes.
//
// Vectors written by the embedding queue are L2-normalised, so cosine
// similarity reduces to a dot product. We still divide by norms in case a
// future caller hands us un-normalised vectors.

import { embed } from '$lib/embed';
import type { NotePath } from '$lib/vault/types';

import { readSidecar } from './sidecar';
import type { Sidecar } from './types';

// Retrieval only reads — it doesn't extend SidecarVault (which requires
// writeNote). Callers can pass a minimal read-only wrapper around the
// production vault.
export interface RetrievalVault {
  readRaw(path: NotePath): Promise<string>;
  listNotes(): Promise<NotePath[]>;
}

export interface RetrievedChunk {
  notePath: NotePath;
  // Index of the chunk inside its sidecar.
  chunkIndex: number;
  text: string;
  heading?: string;
  // Cosine similarity to the query (range -1..1; with normalised vectors,
  // typically 0..1).
  score: number;
  // Pulled from the sidecar so consumers can show "summary X" without a
  // second read.
  summary?: string;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  // Distinct note paths cited, in score-rank order.
  noteRefs: NotePath[];
}

export interface RetrieveOptions {
  k?: number;
  // Defaults to embedding the query via the production embedder. Tests pass
  // a deterministic stub.
  embedQuery?: (query: string) => Promise<Float32Array>;
}

const DEFAULT_K = 5;

export async function retrieve(
  vault: RetrievalVault,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const k = options.k ?? DEFAULT_K;
  const embedFunction = options.embedQuery ?? embed;

  if (query.trim() === '' || k <= 0) {
    return { query, chunks: [], noteRefs: [] };
  }

  const queryVector = await embedFunction(query);
  const notePaths = await vault.listNotes();

  const candidates: RetrievedChunk[] = [];
  for (const path of notePaths) {
    let sidecar: Sidecar | undefined;
    try {
      sidecar = await readSidecar(vault, path);
    } catch {
      // Read failure on one sidecar shouldn't block the rest.
      continue;
    }
    if (sidecar === undefined) continue;
    for (const chunk of sidecar.embeddings) {
      if (chunk.vector.length !== queryVector.length) continue;
      const score = cosine(queryVector, chunk.vector);
      candidates.push({
        notePath: path,
        chunkIndex: chunk.index,
        text: chunk.text,
        ...(chunk.heading !== undefined && { heading: chunk.heading }),
        score,
        ...(sidecar.summary !== undefined && { summary: sidecar.summary }),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const chunks = candidates.slice(0, k);

  // Distinct paths in score-rank order. Using a Set + insertion order makes
  // this fall out naturally.
  const seen = new Set<NotePath>();
  const noteReferences: NotePath[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.notePath)) continue;
    seen.add(chunk.notePath);
    noteReferences.push(chunk.notePath);
  }

  return { query, chunks, noteRefs: noteReferences };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [index, x] of a.entries()) {
    const y = b[index] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Context assembly ─────────────────────────────────────────────────────────

export interface AssembledContext {
  systemPrompt: string;
  userPrompt: string;
  // Chunks that survived the budget cut, in their original rank order.
  includedChunks: RetrievedChunk[];
  // Chunks that were dropped because of the token budget.
  droppedChunks: RetrievedChunk[];
}

export interface AssembleOptions {
  // Maximum context-window tokens (whole prompt budget). Default conservative
  // value covers the smaller Gemma variants (2B = 8K window). Caller can pass
  // the variant's actual window when known.
  contextWindow?: number;
  // Fraction of the window allocated to retrieved content. Architecture §10
  // recommends ~70% for retrieved content, leaving 30% for history + response.
  retrievalFraction?: number;
  // Approximate-tokens-per-character ratio. We use a conservative 0.3 (≈3.3
  // chars/token in English) to budget without invoking the full tokenizer on
  // every retrieval. Caller can pass a real `countTokens` for tighter packing.
  countTokens?: (text: string) => number;
}

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_RETRIEVAL_FRACTION = 0.7;
// Sentinel for the heuristic in approxTokens (used when no countTokens given).
const TOKENS_PER_CHARACTER = 0.3;

export const SYSTEM_PROMPT = [
  "You are the user's second brain. Answer using the provided notes.",
  'Cite the note path when you draw from it. If the notes do not contain',
  "the answer, say so plainly — don't fabricate.",
].join('\n');

export function assembleContext(
  result: RetrievalResult,
  options: AssembleOptions = {},
): AssembledContext {
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const retrievalFraction = options.retrievalFraction ?? DEFAULT_RETRIEVAL_FRACTION;
  const countTokens = options.countTokens ?? approxTokens;

  const retrievalBudget = Math.floor(contextWindow * retrievalFraction);

  const included: RetrievedChunk[] = [];
  const dropped: RetrievedChunk[] = [];
  let used = 0;
  for (const chunk of result.chunks) {
    const fragment = renderChunk(chunk);
    const tokens = countTokens(fragment);
    if (used + tokens > retrievalBudget && included.length > 0) {
      dropped.push(chunk);
      continue;
    }
    included.push(chunk);
    used += tokens;
  }

  const contextLines = included.map((chunk) => `- ${renderChunk(chunk)}`);
  const userPrompt =
    contextLines.length === 0
      ? result.query
      : ['Context:', ...contextLines, '', `User question: ${result.query}`].join('\n');

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    includedChunks: included,
    droppedChunks: dropped,
  };
}

function renderChunk(chunk: RetrievedChunk): string {
  const headingPart = chunk.heading === undefined ? '' : ` (${chunk.heading})`;
  return `[${chunk.notePath}${headingPart}] ${chunk.text}`;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHARACTER);
}

// Re-export EMBEDDING_DIMENSIONS so callers verifying vector compatibility
// don't have to import from $lib/embed too.
export { EMBEDDING_DIMENSIONS } from '$lib/embed';

// Re-export the chunk type for UI consumers.
export type { SidecarEmbeddingChunk } from './types';
