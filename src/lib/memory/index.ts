// Public memory API.
//
// Production wires the singleton queues here, hung off the production vault
// and SyncEngine. Tests instantiate the queues directly with fakes.

import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

import { GEMMA_MODEL_ID, getEngine, gpuLease } from '$lib/llm/runtime';
import { logError } from '$lib/log';
import { syncEngine } from '$lib/sync';
import { subscribeToVaultChanges, vault } from '$lib/vault';

import { createEmbeddingQueue, type EmbeddingQueue, type EmbeddingVault } from './embedding-queue';
import {
  createExtractionQueue,
  type ExtractionGates,
  type ExtractionLLM,
  type ExtractionQueue,
  type ExtractionVault,
} from './extraction-queue';
import {
  createIndexedDatabaseQueueStorage,
  noopQueueStorage,
  type QueueStorage,
} from './queue-storage';
import { readSidecar } from './sidecar';
import { createSidecarConflictResolver } from './sidecar-conflict';
import { isSidecarPath, noteToSidecarPath } from './sidecar-format';
import type { SidecarStatus, SidecarSummary } from './types';

export type { Sidecar, SidecarStatus, SidecarSummary } from './types';
export { hashContent, isSidecarFresh } from './hash';
export {
  parseSidecar,
  serializeSidecar,
  isSidecarPath,
  noteToSidecarPath,
  sidecarToNotePath,
} from './sidecar-format';
export { readSidecar, writeSidecar, isUpToDate } from './sidecar';
export type { EmbeddingQueue, EmbeddingQueueStatus } from './embedding-queue';
export type {
  ExtractionQueue,
  ExtractionQueueStatus,
  ExtractionGates,
  ExtractionLLM,
} from './extraction-queue';
export type { GpuLease } from './gpu-lease';
export { createGpuLease } from './gpu-lease';
export { createEmbeddingQueue } from './embedding-queue';
export { createExtractionQueue } from './extraction-queue';
export { filterStatus, filterStatus as filterSidecarConflicts } from './sidecar-conflict';
export { createSidecarConflictResolver } from './sidecar-conflict';
export { retrieve, cosine, assembleContext, SYSTEM_PROMPT } from './retrieve';
export type {
  RetrievedChunk,
  RetrievalResult,
  RetrieveOptions,
  AssembledContext,
  AssembleOptions,
  RetrievalVault,
} from './retrieve';

// Production singleton wiring -------------------------------------------------

const productionVault: EmbeddingVault & ExtractionVault = {
  readNote: async (path) => {
    // Vault.readNote returns content + frontmatter, but the queues just need
    // the body string.
    const note = await vault.readNote(path);
    return { content: note.content };
  },
  readRaw: (path) => vault.readRaw(path),
  writeNote: (path, content) => vault.writeNote(path, content),
};

// IndexedDB-backed in browser; no-op when running under Node (e.g. SSR
// prerender pass — though we're SSR-off, prerender still evaluates layout
// modules briefly). The cast to unknown bypasses TS's belief that
// `globalThis.indexedDB` is always present — it isn't, in Node.
const queueStorage: QueueStorage =
  (globalThis as { indexedDB?: unknown }).indexedDB === undefined
    ? noopQueueStorage
    : createIndexedDatabaseQueueStorage();

// `gpuLease` is owned by `$lib/llm/runtime` (chat acquires it most often).
// We just re-expose it here so memory callers can keep using `$lib/memory`.
export { gpuLease } from '$lib/llm/runtime';

export const embeddingQueue: EmbeddingQueue = createEmbeddingQueue({
  vault: productionVault,
  storage: queueStorage,
});

const userActivity = createUserActivityGates();

const llmAdapter: ExtractionLLM = {
  modelId: () => (getEngine() === undefined ? undefined : GEMMA_MODEL_ID),
  complete: async (systemPrompt, userPrompt) => {
    const engine = getEngine();
    if (engine === undefined) {
      throw new Error('LLM engine not loaded');
    }
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const completion = await engine.chat.completions.create({ messages, stream: false });
    const choice = completion.choices[0];
    return typeof choice?.message.content === 'string' ? choice.message.content : '';
  },
};

export const extractionQueue: ExtractionQueue = createExtractionQueue({
  vault: productionVault,
  gpuLease,
  gates: userActivity.gates,
  llm: llmAdapter,
});

export const sidecarConflictResolver = createSidecarConflictResolver({
  syncEngine,
  vault: productionVault,
  onRegenerate: (notePath) => {
    embeddingQueue.enqueue(notePath);
  },
});

// Hook the vault → memory pipeline. Every note write also enqueues the
// note for embedding (sidecars are filtered out — we don't embed sidecars).
// Note: the previous `onChange` (sync notify) was injected at vault
// construction; this hook layers on top via the exposed change-stream.
//
// We expose this as a function rather than auto-subscribing on import to
// keep the module side-effect surface explicit. The layout calls
// `bootstrapMemory()` once on mount.
let bootstrapped = false;
let stopActivity: (() => void) | undefined;
let unsubscribeFromVault: (() => void) | undefined;

export function bootstrapMemory(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  stopActivity = userActivity.start();
  unsubscribeFromVault = subscribeToVaultChanges((path) => {
    notifyMemoryOfChange(path);
  });

  void embeddingQueue.hydrate().catch((error: unknown) => {
    logError('memory/bootstrap-hydrate', { error });
  });
}

export function teardownMemoryForTest(): void {
  bootstrapped = false;
  stopActivity?.();
  stopActivity = undefined;
  unsubscribeFromVault?.();
  unsubscribeFromVault = undefined;
  extractionQueue.stop();
  sidecarConflictResolver.stop();
}

export function notifyMemoryOfChange(path: string): void {
  // Sidecars (.memory/...) are written by the queues themselves — re-enqueueing
  // would loop. Chat sessions (.chats/...) sync via the same vault → sync
  // pipeline, but we don't want to embed them either.
  if (isSidecarPath(path)) return;
  if (path.startsWith('.chats/')) return;
  embeddingQueue.enqueue(path);
  extractionQueue.enqueue(path);
}

export function getSidecarPath(notePath: string): string {
  return noteToSidecarPath(notePath);
}

export async function getSidecarSummary(notePath: string): Promise<SidecarSummary> {
  try {
    const sidecar = await readSidecar(productionVault, notePath);
    if (sidecar === undefined) {
      return { source: notePath, status: 'missing' };
    }
    return {
      source: notePath,
      status: deriveStatus(),
      extractedAt: sidecar.extractedAt,
      hasLLMExtraction: sidecar.extractionModel !== undefined,
    };
  } catch (error: unknown) {
    return {
      source: notePath,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function deriveStatus(): SidecarStatus {
  // Without re-hashing the source we can't know if the sidecar is stale
  // versus fresh. Caller layers stale detection on top by passing the note
  // hash; from a pure read, "fresh" is the most informative we can be.
  return 'fresh';
}

// User-activity gates ---------------------------------------------------------

const IDLE_THRESHOLD_MS = 2 * 60 * 1000;
const BATTERY_MIN = 0.5;

interface ActivityHarness {
  gates: ExtractionGates;
  start(): () => void;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

function noop(): void {
  /* no-op */
}

function createUserActivityGates(): ActivityHarness {
  const state = {
    lastActivityAt: Date.now(),
    battery: undefined as BatteryManagerLike | undefined,
  };

  const onActivity = (): void => {
    state.lastActivityAt = Date.now();
  };

  const gates: ExtractionGates = {
    isUserIdle: () => Date.now() - state.lastActivityAt >= IDLE_THRESHOLD_MS,
    isBatteryOk: () => {
      const battery = state.battery;
      if (battery === undefined) return true;
      if (battery.charging) return true;
      return battery.level >= BATTERY_MIN;
    },
  };

  function start(): () => void {
    if ((globalThis as { window?: unknown }).window === undefined) {
      return noop;
    }
    globalThis.window.addEventListener('pointermove', onActivity, { passive: true });
    globalThis.window.addEventListener('keydown', onActivity);
    globalThis.window.addEventListener('touchstart', onActivity, { passive: true });

    const navigatorWithBattery = globalThis.navigator as NavigatorWithBattery;
    let batteryListener: (() => void) | undefined;
    const getBattery = navigatorWithBattery.getBattery;
    if (typeof getBattery === 'function') {
      void getBattery
        .call(navigatorWithBattery)
        .then((manager) => {
          state.battery = manager;
          batteryListener = noop;
          manager.addEventListener('levelchange', batteryListener);
          manager.addEventListener('chargingchange', batteryListener);
          return manager;
        })
        .catch((error: unknown) => {
          logError('memory/battery-init', { error });
        });
    }

    return () => {
      globalThis.window.removeEventListener('pointermove', onActivity);
      globalThis.window.removeEventListener('keydown', onActivity);
      globalThis.window.removeEventListener('touchstart', onActivity);
      const battery = state.battery;
      if (battery !== undefined && batteryListener !== undefined) {
        battery.removeEventListener('levelchange', batteryListener);
        battery.removeEventListener('chargingchange', batteryListener);
      }
    };
  }

  return { gates, start };
}
