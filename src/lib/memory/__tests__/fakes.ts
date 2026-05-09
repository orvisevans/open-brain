// Test fakes shared by the memory queue tests.

import { setEmbedderForTest } from '$lib/embed';
import type { NotePath } from '$lib/vault/types';

import type { EmbeddingVault } from '../embedding-queue';
import type { ExtractionVault } from '../extraction-queue';
import type { QueueStorage } from '../queue-storage';

export class FakeVault implements EmbeddingVault, ExtractionVault {
  // Map of "absolute path inside vault" → file content.
  private readonly notes = new Map<NotePath, string>();
  private readonly sidecars = new Map<NotePath, string>();

  setNote(path: NotePath, content: string): void {
    this.notes.set(path, content);
  }

  hasNote(path: NotePath): boolean {
    return this.notes.has(path);
  }

  readNote(path: NotePath): Promise<{ content: string }> {
    const content = this.notes.get(path);
    if (content === undefined) {
      const error = new Error(`no note at ${path}`) as Error & { code: string };
      error.code = 'ENOENT';
      return Promise.reject(error);
    }
    return Promise.resolve({ content });
  }

  readRaw(path: NotePath): Promise<string> {
    if (path.startsWith('.memory/')) {
      const value = this.sidecars.get(path);
      if (value === undefined) {
        const error = new Error(`no sidecar at ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    }
    const value = this.notes.get(path);
    if (value === undefined) {
      const error = new Error(`no note at ${path}`) as Error & { code: string };
      error.code = 'ENOENT';
      return Promise.reject(error);
    }
    return Promise.resolve(value);
  }

  writeNote(path: NotePath, content: string): Promise<void> {
    if (path.startsWith('.memory/')) {
      this.sidecars.set(path, content);
    } else {
      this.notes.set(path, content);
    }
    return Promise.resolve();
  }

  getSidecar(path: NotePath): string | undefined {
    return this.sidecars.get(path);
  }

  setSidecar(path: NotePath, content: string): void {
    this.sidecars.set(path, content);
  }

  deleteSidecar(path: NotePath): void {
    this.sidecars.delete(path);
  }
}

export class FakeQueueStorage implements QueueStorage {
  embedding: NotePath[] = [];
  extraction: NotePath[] = [];

  loadEmbedding(): Promise<NotePath[]> {
    return Promise.resolve([...this.embedding]);
  }
  saveEmbedding(paths: NotePath[]): Promise<void> {
    this.embedding = [...paths];
    return Promise.resolve();
  }
  loadExtraction(): Promise<NotePath[]> {
    return Promise.resolve([...this.extraction]);
  }
  saveExtraction(paths: NotePath[]): Promise<void> {
    this.extraction = [...paths];
    return Promise.resolve();
  }
}

export interface FakeClock {
  now: () => number;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Advance virtual time by `ms`, firing any due timers. */
  advance: (ms: number) => Promise<void>;
}

interface Pending {
  due: number;
  handler: () => void;
  // Repeating interval (undefined for one-shot timers).
  interval?: number;
  cancelled?: boolean;
}

async function drainMicrotasks(): Promise<void> {
  // Promise chains awakened by a timer can be many microtasks deep.
  // Flush a generous fixed number; far cheaper than tracking pending
  // promises and good enough for the test workloads here.
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

export function createFakeClock(): FakeClock {
  let current = 0;
  let nextId = 1;
  const pending = new Map<unknown, Pending>();

  const flushDueTimers = async (): Promise<void> => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.cancelled !== true && entry.due <= current)
        .sort(([, a], [, b]) => a.due - b.due);
      for (const [id, entry] of due) {
        if (entry.cancelled === true) continue;
        if (entry.interval === undefined) {
          pending.delete(id);
        } else {
          entry.due = current + entry.interval;
        }
        entry.handler();
        progressed = true;
      }
      await drainMicrotasks();
    }
  };

  return {
    now: () => current,
    setTimeout: (handler, ms) => {
      const id = { id: nextId++ };
      pending.set(id, { due: current + ms, handler });
      return id;
    },
    clearTimeout: (handle) => {
      const entry = pending.get(handle);
      if (entry !== undefined) entry.cancelled = true;
      pending.delete(handle);
    },
    setInterval: (handler, ms) => {
      const id = { id: nextId++, interval: true };
      pending.set(id, { due: current + ms, handler, interval: ms });
      return id;
    },
    clearInterval: (handle) => {
      const entry = pending.get(handle);
      if (entry !== undefined) entry.cancelled = true;
      pending.delete(handle);
    },
    advance: async (ms) => {
      current += ms;
      await flushDueTimers();
    },
  };
}

/**
 * Install a deterministic embedder for tests. Returns a teardown function.
 * The fake embedder produces a 384-dim vector where the first element is the
 * length of the input text — enough for tests that just check "got embedded".
 */
export function installFakeEmbedder(): () => void {
  setEmbedderForTest({
    embed(texts) {
      return Promise.resolve(
        texts.map((text) => {
          const vector = new Float32Array(384);
          vector[0] = text.length;
          return vector;
        }),
      );
    },
    countTokens(text) {
      if (text === '') return 0;
      return text.split(/\s+/).filter((word) => word !== '').length;
    },
  });
  return () => {
    setEmbedderForTest(undefined);
  };
}
