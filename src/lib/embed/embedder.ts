// Transformers.js embedding wrapper.
//
// Phase 4 expanded this from the walking-skeleton single-string `embed()`
// into the batched API the embedding queue depends on:
//
//   embed(text)            — single-string convenience (existing call sites)
//   embedBatch(texts)      — batched call, capped at MAX_BATCH per `_call`
//   countTokens(text)      — exact token count via the model's tokenizer
//
// The pipeline is loaded lazily on first use and reused thereafter. Tests
// inject a fake embedder via `setEmbedderForTest` so they don't pay the
// 25 MB ONNX download cost.

import { env, type FeatureExtractionPipeline, pipeline } from '@xenova/transformers';

import { logError } from '$lib/log';

// Skip the same-origin /models/<id>/... probe. Transformers.js defaults to
// checking the current origin before falling back to the Hugging Face CDN —
// fine for projects that self-host ONNX weights, but we never will (HF CDN in
// dev, dedicated mirror in prod). Leaving the default on spams the dev server
// log with benign 404s on every first-time model load.
env.allowLocalModels = false;

export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

// MiniLM's max sequence length is 512 tokens. We chunk well below that so the
// pipeline never silently truncates input.
export const EMBEDDING_MAX_TOKENS = 512;

// Cap each `_call` invocation to keep per-call latency reasonable on lower-end
// devices. The queue feeds chunks in fixed-size batches; the embedder enforces
// the cap as a defence-in-depth.
const MAX_BATCH = 8;

// Lazily initialised. Tests replace this via `setEmbedderForTest`.
let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  pipelinePromise ??= pipeline('feature-extraction', EMBEDDING_MODEL_ID);
  return pipelinePromise;
}

export interface EmbedderForTest {
  embed(texts: string[]): Promise<Float32Array[]>;
  countTokens(text: string): number;
}

let testEmbedder: EmbedderForTest | undefined;

export function setEmbedderForTest(value: EmbedderForTest | undefined): void {
  testEmbedder = value;
}

/**
 * Embed a single string. Returns a 384-dim L2-normalised Float32Array.
 */
export async function embed(text: string): Promise<Float32Array> {
  const [vector] = await embedBatch([text]);
  if (vector === undefined) {
    throw new Error('embedder returned an empty batch');
  }
  return vector;
}

/**
 * Batch-embed an array of strings. Splits internally into sub-batches of
 * `MAX_BATCH`. Returns vectors in input order, one per text.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  if (testEmbedder !== undefined) {
    return testEmbedder.embed(texts);
  }

  const model = await getPipeline();
  const out: Float32Array[] = [];
  for (let offset = 0; offset < texts.length; offset += MAX_BATCH) {
    const batch = texts.slice(offset, offset + MAX_BATCH);
    try {
      const tensor = await model._call(batch, { pooling: 'mean', normalize: true });
      const flat = tensor.data;
      if (!(flat instanceof Float32Array)) {
        throw new TypeError(
          `Expected Float32Array from embedder, got ${Object.prototype.toString.call(flat)}`,
        );
      }
      const stride = flat.length / batch.length;
      if (!Number.isInteger(stride) || stride !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Unexpected embedder stride: got ${String(stride)}, want ${String(EMBEDDING_DIMENSIONS)}`,
        );
      }
      for (let index = 0; index < batch.length; index += 1) {
        // `slice` copies; without it, the caller would hold a view into the
        // pipeline's output buffer that the next `_call` may overwrite.
        out.push(flat.slice(index * stride, (index + 1) * stride));
      }
    } catch (error: unknown) {
      logError('embed/batch', { error, batchSize: batch.length });
      throw error;
    }
  }
  return out;
}

/**
 * Count tokens for `text` using the model's tokenizer. Used by the chunking
 * helper to keep each window under the model's max sequence length.
 */
export async function countTokens(text: string): Promise<number> {
  if (testEmbedder !== undefined) {
    return testEmbedder.countTokens(text);
  }
  const model = await getPipeline();
  const ids = model.tokenizer.encode(text);
  return ids.length;
}
