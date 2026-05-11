// Embedding queue.
//
// State machine (per path):
//   enqueued → idle wait (debounced 30s) → embedding → done
//                   ↑                          │
//                   └────── re-enqueue ────────┘  (if note re-edited)
//
// Inputs:
//   - `enqueue(path)` from the vault notify hook (see `$lib/memory/index`).
//   - `flush()` from the "Refresh memory" button.
//
// Outputs:
//   - `subscribe(listener)` for status (size + state).
//   - On each successful run, the sidecar at `.memory/<path>` is written.
//
// Persistence: the pending set is saved to IndexedDB after every mutation.
// Survives reload so a user who closes the tab mid-edit doesn't lose work.

import { chunkMarkdown, countTokens, embedBatch, EMBEDDING_MODEL_ID } from '$lib/embed';
import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

import { chunkChatSession } from './chat-chunker';
import { hashContent, isSidecarFresh } from './hash';
import type { QueueStorage } from './queue-storage';
import { readSidecar, writeSidecar, type SidecarVault } from './sidecar';
import type { Sidecar, SidecarEmbeddingChunk } from './types';
import { SIDECAR_SCHEMA_VERSION } from './types';

// Chat session files live under `.chats/` and use the chat-aware chunker so
// retrieval can carry role + message metadata. Anything else uses the
// markdown chunker. Phase 5.7.
const CHAT_PREFIX = '.chats/';

export interface EmbeddingQueueOptions {
  vault: EmbeddingVault;
  storage: QueueStorage;
  // Debounce window in ms (default 30s). Tests pass smaller values.
  debounceMs?: number;
  // Max chunks embedded per call. Defaults to 8.
  batchSize?: number;
  // DI for tests.
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

export interface EmbeddingVault extends SidecarVault {
  readNote(path: NotePath): Promise<{ content: string }>;
}

function isChatPath(path: NotePath): boolean {
  return path.startsWith(CHAT_PREFIX);
}

export type EmbeddingQueueState = 'idle' | 'waiting' | 'running' | 'error';

export interface EmbeddingQueueStatus {
  state: EmbeddingQueueState;
  pending: NotePath[];
  // Per-path soft errors (e.g. note not found, embedder threw).
  errors: Record<NotePath, string>;
}

export interface EmbeddingQueue {
  readonly status: { value: EmbeddingQueueStatus };
  enqueue(path: NotePath): void;
  enqueueAll(paths: NotePath[]): void;
  /** Force-run now, regardless of the debounce window. */
  flush(): Promise<void>;
  /** Hydrate the pending set from persistence (call on app start). */
  hydrate(): Promise<void>;
  /** Resolves when the queue settles (debounce expires + drain completes). */
  whenIdle(): Promise<void>;
  subscribe(listener: (status: EmbeddingQueueStatus) => void): () => void;
}

const DEFAULT_DEBOUNCE_MS = 30_000;

export function createEmbeddingQueue(options: EmbeddingQueueOptions): EmbeddingQueue {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimer = options.setTimeoutImpl ?? ((handler, ms) => globalThis.setTimeout(handler, ms));
  const clearTimer =
    options.clearTimeoutImpl ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  const pending = new Set<NotePath>();
  const errors: Record<NotePath, string> = {};
  let timer: unknown;
  let running = false;
  // True while a run is in flight; another enqueue arrives → re-run after current.
  let needsRerun = false;
  // Tracks the in-flight drain so `whenIdle()` and `flush()` can await it.
  let inFlight: Promise<void> | undefined;

  const status = {
    value: snapshot('idle'),
  };
  const listeners = new Set<(status: EmbeddingQueueStatus) => void>();

  function emit(state: EmbeddingQueueState): void {
    status.value = snapshot(state);
    for (const listener of listeners) {
      try {
        listener(status.value);
      } catch (error: unknown) {
        logError('memory/embedding-queue/listener', { error });
      }
    }
  }

  function snapshot(state: EmbeddingQueueState): EmbeddingQueueStatus {
    return {
      state,
      pending: [...pending].sort((a, b) => a.localeCompare(b)),
      errors: { ...errors },
    };
  }

  function persist(): void {
    void options.storage.saveEmbedding([...pending]);
  }

  function scheduleRun(): void {
    if (timer !== undefined) {
      clearTimer(timer);
    }
    if (pending.size === 0) {
      emit('idle');
      return;
    }
    emit('waiting');
    timer = setTimer(() => {
      timer = undefined;
      const run = runOnce();
      inFlight = run;
      void run.finally(() => {
        if (inFlight === run) inFlight = undefined;
      });
    }, debounceMs);
  }

  async function runOnce(): Promise<void> {
    if (running) {
      // Caller fired during an in-flight run. Schedule a follow-up so we
      // don't drop work that arrived mid-run.
      needsRerun = true;
      return;
    }
    if (pending.size === 0) {
      emit('idle');
      return;
    }
    running = true;
    emit('running');
    const paths = [...pending];
    try {
      for (const path of paths) {
        try {
          await processPath(path);
          pending.delete(path);
          Reflect.deleteProperty(errors, path);
        } catch (error: unknown) {
          errors[path] = error instanceof Error ? error.message : String(error);
          logError('memory/embedding-queue/process', { path, error });
          // Leave the path in `pending` so it retries on the next run.
        }
      }
      persist();
    } finally {
      running = false;
    }
    if (needsRerun) {
      needsRerun = false;
      scheduleRun();
      return;
    }
    if (pending.size > 0) {
      // Some paths failed; surface the error state and let the next enqueue
      // (or a manual flush) retry.
      emit('error');
      return;
    }
    emit('idle');
  }

  async function processPath(path: NotePath): Promise<void> {
    // Chat sessions read the raw on-disk markdown so the chat chunker can
    // see the role/timestamp headers; readNote would strip frontmatter
    // metadata we need. Hash the raw content too — embedding-freshness is
    // about source identity, not about post-parse content.
    const isChat = isChatPath(path);
    let chunkable: string;
    if (isChat) {
      chunkable = await options.vault.readRaw(path);
    } else {
      const note = await options.vault.readNote(path);
      chunkable = note.content;
    }
    const noteHash = await hashContent(chunkable);
    const existing = await readSidecar(options.vault, path);
    if (existing !== undefined && isSidecarFresh(noteHash, existing)) {
      // Already up-to-date — nothing to do.
      return;
    }

    let embeddings: SidecarEmbeddingChunk[] = [];
    if (isChat) {
      const chatChunks = await chunkChatSession(chunkable, { countTokens });
      if (chatChunks.length > 0) {
        const vectors = await embedBatch(chatChunks.map((chunk) => chunk.text));
        embeddings = chatChunks.map((chunk, index) => {
          const vector = vectors[index];
          if (vector === undefined) {
            throw new Error(`embedder returned no vector for chunk ${String(index)}`);
          }
          return {
            index: chunk.index,
            text: chunk.text,
            vector,
            ...(chunk.heading !== undefined && { heading: chunk.heading }),
            start: chunk.start,
            end: chunk.end,
            role: chunk.role,
            messageIndex: chunk.messageIndex,
            messageTimestamp: chunk.messageTimestamp,
          };
        });
      }
    } else {
      const chunks = await chunkMarkdown(chunkable, { countTokens });
      if (chunks.length > 0) {
        const vectors = await embedBatch(chunks.map((chunk) => chunk.text));
        embeddings = chunks.map((chunk, index) => {
          const vector = vectors[index];
          if (vector === undefined) {
            throw new Error(`embedder returned no vector for chunk ${String(index)}`);
          }
          return {
            index: chunk.index,
            text: chunk.text,
            vector,
            ...(chunk.heading !== undefined && { heading: chunk.heading }),
            start: chunk.start,
            end: chunk.end,
          };
        });
      }
    }

    // Preserve any LLM-extracted fields from the prior sidecar so we don't
    // lose `summary`/`entities`/etc. just because the note's content was
    // tweaked. The LLM extraction queue will refresh them on its own cadence.
    const sidecar: Sidecar = {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      source: path,
      sourceHash: noteHash,
      extractedAt: Date.now(),
      embeddingModel: EMBEDDING_MODEL_ID,
      ...(existing?.extractionModel !== undefined && {
        extractionModel: existing.extractionModel,
      }),
      embeddings,
      ...(existing?.summary !== undefined && { summary: existing.summary }),
      ...(existing?.entities !== undefined && { entities: existing.entities }),
      ...(existing?.facts !== undefined && { facts: existing.facts }),
      ...(existing?.topics !== undefined && { topics: existing.topics }),
      ...(existing?.links !== undefined && { links: existing.links }),
    };
    await writeSidecar(options.vault, sidecar);
  }

  function enqueue(path: NotePath): void {
    pending.add(path);
    persist();
    scheduleRun();
  }

  function enqueueAll(paths: NotePath[]): void {
    for (const path of paths) pending.add(path);
    persist();
    scheduleRun();
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    if (inFlight !== undefined) {
      await inFlight;
    }
    inFlight = runOnce();
    try {
      await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  async function whenIdle(): Promise<void> {
    while (inFlight !== undefined) {
      await inFlight;
    }
  }

  async function hydrate(): Promise<void> {
    const restored = await options.storage.loadEmbedding();
    if (restored.length === 0) return;
    for (const path of restored) pending.add(path);
    scheduleRun();
  }

  function subscribe(listener: (status: EmbeddingQueueStatus) => void): () => void {
    listeners.add(listener);
    listener(status.value);
    return () => listeners.delete(listener);
  }

  return { status, enqueue, enqueueAll, flush, hydrate, whenIdle, subscribe };
}
