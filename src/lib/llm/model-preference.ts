// Last-loaded WebLLM variant — localStorage only (per-device, like TTS).
// WebLLM weights stay in their own IndexedDB cache; this is just the id.

const STORAGE_KEY = 'openbrain.preferred-model-id';

export function loadPreferredModelId(): string | undefined {
  try {
    const value = globalThis.localStorage.getItem(STORAGE_KEY);
    return value === null || value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

export function savePreferredModelId(modelId: string): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, modelId);
  } catch {
    // localStorage may be unavailable (SSR, private mode); skip silently.
  }
}

export function clearPreferredModelId(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
