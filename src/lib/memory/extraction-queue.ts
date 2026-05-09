// LLM extraction queue.
//
// Enriches sidecars with summary/entities/facts/topics produced by the local
// LLM. Distinct from the embedding queue because it has very different
// resource constraints:
//
//   - Gates on user idle (no input for ~2 minutes).
//   - Gates on battery state (skip if <50% and not charging).
//   - Gates on the GPU lease (yields to chat).
//   - Slow per-note (a few seconds of inference).
//
// We don't persist this queue — extraction is opportunistic, and the source
// of truth is "every note that has an embedding sidecar but no
// `extractionModel` set". On startup the consumer can call `enqueueAll(...)`
// for any stale sidecars to repopulate.

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  parseExtractionResponse,
} from './extract';
import type { GpuLease } from './gpu-lease';
import { readSidecar, writeSidecar, type SidecarVault } from './sidecar';
import type { Sidecar } from './types';

export interface ExtractionVault extends SidecarVault {
  readNote(path: NotePath): Promise<{ content: string }>;
}

export interface ExtractionGates {
  /** True if the user has been idle for at least the gate window. */
  isUserIdle(): boolean;
  /** True if running extraction is allowed by battery state. */
  isBatteryOk(): Promise<boolean> | boolean;
}

export interface ExtractionLLM {
  /** Resolves the model identifier to record on the sidecar. */
  modelId(): string | undefined;
  /** Streams (or one-shots) a chat completion. Returns the full response text. */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface ExtractionQueueOptions {
  vault: ExtractionVault;
  gpuLease: GpuLease;
  gates: ExtractionGates;
  llm: ExtractionLLM;
  // How often to poll for an opportunity to drain the queue. Default 30s.
  // Tests pass small values.
  tickMs?: number;
  setIntervalImpl?: (handler: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}

export type ExtractionQueueState = 'idle' | 'waiting' | 'running' | 'paused';

export interface ExtractionQueueStatus {
  state: ExtractionQueueState;
  pending: NotePath[];
  errors: Record<NotePath, string>;
  pauseReason?: 'battery' | 'busy-user' | 'gpu-busy' | 'no-llm';
}

export interface ExtractionQueue {
  readonly status: { value: ExtractionQueueStatus };
  enqueue(path: NotePath): void;
  enqueueAll(paths: NotePath[]): void;
  /** Force-run, ignoring all gates (used by the "Refresh memory" button). */
  flush(): Promise<void>;
  /** Stop the polling timer (for cleanup). */
  stop(): void;
  /** Resolves when the queue settles (current drain completes). */
  whenIdle(): Promise<void>;
  subscribe(listener: (status: ExtractionQueueStatus) => void): () => void;
}

const DEFAULT_TICK_MS = 30_000;

export function createExtractionQueue(options: ExtractionQueueOptions): ExtractionQueue {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const setIntervalFunction: (handler: () => void, ms: number) => unknown =
    options.setIntervalImpl ?? ((handler, ms) => globalThis.setInterval(handler, ms));
  const clearIntervalFunction: (handle: unknown) => void =
    options.clearIntervalImpl ??
    ((handle) => {
      globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
    });

  const pending = new Set<NotePath>();
  const errors: Record<NotePath, string> = {};
  let running = false;
  let inFlight: Promise<void> | undefined;
  let timer: unknown = setIntervalFunction(() => {
    const run = tryDrain();
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = undefined;
    });
  }, tickMs);

  const status = { value: snapshot('idle') };
  const listeners = new Set<(status: ExtractionQueueStatus) => void>();

  function emit(
    state: ExtractionQueueState,
    pauseReason?: ExtractionQueueStatus['pauseReason'],
  ): void {
    status.value = snapshot(state, pauseReason);
    for (const listener of listeners) {
      try {
        listener(status.value);
      } catch (error: unknown) {
        logError('memory/extraction-queue/listener', { error });
      }
    }
  }

  function snapshot(
    state: ExtractionQueueState,
    pauseReason?: ExtractionQueueStatus['pauseReason'],
  ): ExtractionQueueStatus {
    return {
      state,
      pending: [...pending].sort((a, b) => a.localeCompare(b)),
      errors: { ...errors },
      ...(pauseReason !== undefined && { pauseReason }),
    };
  }

  async function tryDrain(): Promise<void> {
    if (running) return;
    if (pending.size === 0) {
      emit('idle');
      return;
    }
    if (options.llm.modelId() === undefined) {
      emit('paused', 'no-llm');
      return;
    }
    if (!options.gates.isUserIdle()) {
      emit('paused', 'busy-user');
      return;
    }
    const batteryOk = await options.gates.isBatteryOk();
    if (!batteryOk) {
      emit('paused', 'battery');
      return;
    }
    if (options.gpuLease.isContended()) {
      emit('paused', 'gpu-busy');
      return;
    }
    await drain();
  }

  async function drain(forced = false): Promise<void> {
    if (running) return;
    if (pending.size === 0) {
      emit('idle');
      return;
    }
    running = true;
    emit('running');
    const paths = [...pending];
    try {
      for (const path of paths) {
        // Re-check gates between paths so the queue yields immediately if
        // the user starts typing or chat acquires the GPU.
        if (!forced && !options.gates.isUserIdle()) {
          emit('paused', 'busy-user');
          return;
        }
        if (!forced && options.gpuLease.isContended()) {
          emit('paused', 'gpu-busy');
          return;
        }

        const release = await options.gpuLease.acquire('extract');
        try {
          await processPath(path);
          pending.delete(path);
          Reflect.deleteProperty(errors, path);
        } catch (error: unknown) {
          errors[path] = error instanceof Error ? error.message : String(error);
          logError('memory/extraction-queue/process', { path, error });
        } finally {
          release();
        }
      }
    } finally {
      running = false;
    }
    if (pending.size > 0 && Object.keys(errors).length > 0) {
      emit('idle');
      return;
    }
    emit('idle');
  }

  async function processPath(path: NotePath): Promise<void> {
    const note = await options.vault.readNote(path);
    const sidecar = await readSidecar(options.vault, path);
    if (sidecar === undefined) {
      // No embedding sidecar yet — wait for the embedding queue to lay one
      // down. Skipping rather than erroring so we don't pile up retries.
      return;
    }
    const modelId = options.llm.modelId();
    if (modelId === undefined) {
      throw new Error('LLM model not loaded');
    }
    const response = await options.llm.complete(
      EXTRACTION_SYSTEM_PROMPT,
      buildExtractionUserPrompt(note.content),
    );
    const extraction = parseExtractionResponse(response);

    const updated: Sidecar = {
      ...sidecar,
      extractionModel: modelId,
      extractedAt: Date.now(),
      summary: extraction.summary,
      entities: extraction.entities,
      facts: extraction.facts,
      topics: extraction.topics,
      links: extraction.links,
    };
    await writeSidecar(options.vault, updated);
  }

  function enqueue(path: NotePath): void {
    pending.add(path);
    emit('waiting');
  }

  function enqueueAll(paths: NotePath[]): void {
    for (const path of paths) pending.add(path);
    emit('waiting');
  }

  async function flush(): Promise<void> {
    // Even forced flush has to respect "no LLM loaded" — every path would
    // throw "LLM not loaded" otherwise. Surface as a paused state instead.
    if (options.llm.modelId() === undefined) {
      emit('paused', 'no-llm');
      return;
    }
    if (inFlight !== undefined) {
      await inFlight;
    }
    inFlight = drain(true);
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

  function stop(): void {
    if (timer !== undefined) {
      clearIntervalFunction(timer);
      timer = undefined;
    }
  }

  function subscribe(listener: (status: ExtractionQueueStatus) => void): () => void {
    listeners.add(listener);
    listener(status.value);
    return () => listeners.delete(listener);
  }

  return { status, enqueue, enqueueAll, flush, stop, whenIdle, subscribe };
}
