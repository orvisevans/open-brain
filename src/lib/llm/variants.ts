// Catalogue of LLM variants the user can load.
//
// Sizes are quoted from WebLLM's published model card metadata (q4f16_1
// quantisation). VRAM estimates assume the model is fully resident (no CPU
// fallback). Numbers are approximate — they're shown to the user as a rough
// guide, not a hard guarantee.

export interface ModelVariant {
  id: string;
  // Short human label, e.g. "Gemma 2 (2B)".
  label: string;
  // Parameter count as a string (e.g. "2B", "9B").
  parameters: string;
  // Approximate on-disk download size in megabytes.
  downloadMb: number;
  // Approximate VRAM footprint in megabytes when loaded.
  vramMb: number;
  // Context window in tokens.
  contextWindow: number;
  // One-line description.
  description: string;
}

export const MODEL_VARIANTS: readonly ModelVariant[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 (1B)',
    parameters: '1B',
    downloadMb: 800,
    vramMb: 1500,
    contextWindow: 4096,
    description: 'Smallest option. Fast on weak GPUs / iGPUs; lighter quality.',
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 (2B)',
    parameters: '2B',
    downloadMb: 1500,
    vramMb: 2400,
    contextWindow: 8192,
    description: 'Default for laptops with 4GB+ VRAM. Good balance.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 (3B)',
    parameters: '3B',
    downloadMb: 2200,
    vramMb: 3500,
    contextWindow: 8192,
    description: 'Higher quality reasoning at a moderate VRAM cost.',
  },
  {
    id: 'gemma-2-9b-it-q4f16_1-MLC',
    label: 'Gemma 2 (9B)',
    parameters: '9B',
    downloadMb: 5800,
    vramMb: 8200,
    contextWindow: 8192,
    description: 'Best quality. Requires 8GB+ VRAM (desktop GPU).',
  },
];

export const DEFAULT_VARIANT_ID = 'gemma-2-2b-it-q4f16_1-MLC';

export function getVariant(id: string): ModelVariant | undefined {
  return MODEL_VARIANTS.find((variant) => variant.id === id);
}
