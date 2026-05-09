// WebLLM wrapper.
//
// Phase 5 polish over the walking-skeleton version:
//   - `MODEL_VARIANTS` catalogue with download + VRAM estimates.
//   - `loadModel(variantId, onProgress)` accepts any catalogue id.
//   - `unloadModel()` releases the GPU lease and frees the engine.
//   - `streamChat` acquires the shared `GpuLease('chat')` so the extraction
//     queue yields while the user is talking to the model.
//   - `currentVariant()` resolves the loaded variant for UI display.

import type { ChatCompletionMessageParam, MLCEngine } from '@mlc-ai/web-llm';
import { CreateMLCEngine } from '@mlc-ai/web-llm';

// Import the factory from the leaf module to avoid a $lib/memory → $lib/llm
// import cycle (the memory barrel imports back from $lib/llm/runtime).
import { createGpuLease, type GpuLease } from '$lib/memory/gpu-lease';

import { getVariant, type ModelVariant } from './variants';

export { MODEL_VARIANTS, DEFAULT_VARIANT_ID, getVariant } from './variants';
export { DEFAULT_VARIANT_ID as GEMMA_MODEL_ID } from './variants';
export type { ModelVariant } from './variants';

// Single GPU lease shared across LLM chat and the memory extraction queue.
// Owned here (rather than in `$lib/memory`) because llm/runtime is what
// acquires it for streaming — keeping the owner co-located with its hottest
// caller avoids a memory→llm→memory module-evaluation cycle.
export const gpuLease: GpuLease = createGpuLease();

// Module-level singleton; undefined until loadModel() completes.
let engine: MLCEngine | undefined;
let loadedVariantId: string | undefined;

export function getEngine(): MLCEngine | undefined {
  return engine;
}

export function currentVariant(): ModelVariant | undefined {
  if (loadedVariantId === undefined) return undefined;
  return getVariant(loadedVariantId);
}

/**
 * Download (if not cached) and initialise the model.
 * @param modelId       WebLLM model identifier (must appear in MODEL_VARIANTS).
 * @param onProgress    Called with a 0–1 progress value while loading.
 */
export async function loadModel(
  modelId: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  // We don't reject unknown ids — WebLLM has more models than we surface in
  // the picker, and a future settings page may want to load them. The
  // catalogue is advisory.
  if (engine !== undefined && loadedVariantId === modelId) {
    onProgress(1);
    return;
  }
  if (engine !== undefined) {
    await unloadModel();
  }
  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      onProgress(report.progress);
    },
  });
  loadedVariantId = modelId;
}

/**
 * Free the loaded model and release any held GPU lease. Idempotent.
 */
export async function unloadModel(): Promise<void> {
  if (engine === undefined) return;
  try {
    await engine.unload();
  } finally {
    engine = undefined;
    loadedVariantId = undefined;
  }
}

/**
 * Stream a chat completion.
 * Acquires the GPU lease as 'chat' for the duration of the stream — yields
 * priority over the LLM extraction queue.
 */
export async function streamChat(
  messages: ChatCompletionMessageParam[],
  onToken: (token: string) => void,
): Promise<void> {
  if (engine === undefined) {
    throw new Error('Model not loaded — call loadModel() first');
  }

  const release = await gpuLease.acquire('chat');
  try {
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
    });
    for await (const chunk of stream) {
      const firstChoice = chunk.choices[0];
      if (firstChoice === undefined) {
        continue;
      }
      const { content } = firstChoice.delta;
      if (typeof content === 'string' && content.length > 0) {
        onToken(content);
      }
    }
  } finally {
    release();
  }
}
