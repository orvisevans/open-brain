// Transformers.js embedding wrapper for Phase 1 walking skeleton.
// Phase 4 will expand this into the full Embedder with batching, chunking,
// and hash-invalidation-aware sidecar writes.

import { env, type FeatureExtractionPipeline, pipeline } from '@xenova/transformers';

// Skip the same-origin /models/<id>/... probe. Transformers.js defaults to
// checking the current origin before falling back to the Hugging Face CDN —
// fine for projects that self-host ONNX weights, but we never will (HF CDN in
// dev, dedicated mirror in prod). Leaving the default on spams the dev server
// log with benign 404s on every first-time model load.
env.allowLocalModels = false;

// Lazily initialised — first call triggers model download.
let embedder: FeatureExtractionPipeline | undefined;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  embedder ??= await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return embedder;
}

/**
 * Embed a single string using all-MiniLM-L6-v2 (384 dimensions, mean-pooled,
 * L2-normalised).
 */
export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder();
  const output = await model._call(text, { pooling: 'mean', normalize: true });
  const rawData = output.data;

  if (!(rawData instanceof Float32Array)) {
    throw new TypeError(
      `Expected Float32Array from embedder, got ${Object.prototype.toString.call(rawData)}`,
    );
  }

  return rawData;
}
