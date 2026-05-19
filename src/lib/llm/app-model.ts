// Load WebLLM into the shared `model` rune and persist the user's choice.

import { logError } from '$lib/log';
import { model } from '$lib/state.svelte';

import { loadPreferredModelId, savePreferredModelId } from './model-preference';
import { currentVariant, getEngine, loadModel } from './runtime';

let loadInFlight: Promise<void> | undefined;

function syncModelFromEngine(): void {
  const variant = currentVariant();
  if (variant === undefined) return;
  model.loaded = true;
  model.loading = false;
  model.id = variant.id;
  model.progress = 1;
}

/**
 * Download (if needed) and initialise a model, updating global UI state.
 * Safe to call when the same variant is already loaded (no-op).
 */
export async function loadAppModel(modelId: string): Promise<void> {
  if (getEngine() !== undefined && model.id === modelId && model.loaded) {
    syncModelFromEngine();
    return;
  }
  if (loadInFlight !== undefined) {
    await loadInFlight;
    if (getEngine() !== undefined && model.id === modelId && model.loaded) return;
  }

  loadInFlight = (async () => {
    model.loading = true;
    model.loaded = false;
    model.progress = 0;
    model.id = modelId;
    try {
      await loadModel(modelId, (progress) => {
        model.progress = progress;
      });
      model.loaded = true;
      savePreferredModelId(modelId);
    } catch (error: unknown) {
      model.loaded = false;
      throw error;
    } finally {
      model.loading = false;
    }
  })();

  try {
    await loadInFlight;
  } finally {
    loadInFlight = undefined;
  }
}

/**
 * After refresh or HMR: reload the last-used model if the in-memory engine
 * was lost but a preference is stored.
 */
export async function bootstrapAppModel(): Promise<void> {
  if (getEngine() !== undefined) {
    syncModelFromEngine();
    return;
  }
  if (model.loading) return;

  const preferred = loadPreferredModelId();
  if (preferred === undefined) return;

  try {
    await loadAppModel(preferred);
  } catch (error: unknown) {
    logError('llm/bootstrap-model', { error, modelId: preferred });
  }
}
