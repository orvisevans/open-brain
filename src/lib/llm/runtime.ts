// WebLLM wrapper for Phase 1 walking skeleton.
// Phase 5 will expand this into the full LLMRuntime class with model selection,
// VRAM coordination, and GpuLease management.

import type { ChatCompletionMessageParam, MLCEngine } from '@mlc-ai/web-llm';
import { CreateMLCEngine } from '@mlc-ai/web-llm';

// Smallest available Gemma 2 variant in the WebLLM model catalogue.
// The plan mentions "Gemma-1B"; the Gemma 2 series starts at 2B parameters.
export const GEMMA_MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC';

// Module-level singleton; undefined until loadModel() completes.
let engine: MLCEngine | undefined;

export function getEngine(): MLCEngine | undefined {
  return engine;
}

/**
 * Download (if not cached) and initialise the model.
 * @param modelId       WebLLM model identifier.
 * @param onProgress    Called with a 0–1 progress value while loading.
 */
export async function loadModel(
  modelId: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      onProgress(report.progress);
    },
  });
}

/**
 * Stream a chat completion.
 * Accepts standard OpenAI-compatible message params from WebLLM.
 */
export async function streamChat(
  messages: ChatCompletionMessageParam[],
  onToken: (token: string) => void,
): Promise<void> {
  if (engine === undefined) {
    throw new Error('Model not loaded — call loadModel() first');
  }

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
}
