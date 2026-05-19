import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPreferredModelId,
  loadPreferredModelId,
  savePreferredModelId,
} from '../model-preference';

const STORAGE_KEY = 'openbrain.preferred-model-id';

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  globalThis.localStorage.clear();
});

describe('model-preference', () => {
  it('returns undefined when nothing stored', () => {
    expect(loadPreferredModelId()).toBeUndefined();
  });

  it('round-trips a model id', () => {
    savePreferredModelId('gemma-2-2b-it-q4f16_1-MLC');
    expect(loadPreferredModelId()).toBe('gemma-2-2b-it-q4f16_1-MLC');
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe('gemma-2-2b-it-q4f16_1-MLC');
  });

  it('clear removes the preference', () => {
    savePreferredModelId('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    clearPreferredModelId();
    expect(loadPreferredModelId()).toBeUndefined();
  });
});
