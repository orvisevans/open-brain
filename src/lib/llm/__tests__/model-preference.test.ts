import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPreferredModelId,
  loadPreferredModelId,
  savePreferredModelId,
} from '../model-preference';

const STORAGE_KEY = 'openbrain.preferred-model-id';

// vitest runs in the node environment by default; localStorage is a DOM
// API. Install a minimal in-memory shim so the production code (which
// reads/writes via globalThis.localStorage) can run unmodified.
class MemoryStorage {
  private store = new Map<string, string>();
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    // eslint-disable-next-line unicorn/no-null -- Storage interface requires null
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    // eslint-disable-next-line unicorn/no-null -- Storage interface requires null
    return [...this.store.keys()][index] ?? null;
  }
}

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

afterEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage?.clear();
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
