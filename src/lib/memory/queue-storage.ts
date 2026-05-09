// IndexedDB persistence for the embedding queue.
//
// The queue is a `Set<NotePath>`; we persist it under `openbrain-queues`
// (per ARCHITECTURE §5). Survives reload so a user who closes the tab
// mid-edit doesn't lose pending embedding work.
//
// We read once on startup and write on every queue mutation. The dataset is
// tiny (typically <100 paths × ~30 bytes), so we don't bother with deltas.

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

const DB_NAME = 'openbrain-queues';
const DB_VERSION = 1;
const STORE = 'pending';
const KEY_EMBEDDING = 'embedding';
const KEY_EXTRACTION = 'extraction';

export interface QueueStorage {
  loadEmbedding(): Promise<NotePath[]>;
  saveEmbedding(paths: NotePath[]): Promise<void>;
  loadExtraction(): Promise<NotePath[]>;
  saveExtraction(paths: NotePath[]): Promise<void>;
}

export const noopQueueStorage: QueueStorage = {
  loadEmbedding: () => Promise.resolve([]),
  saveEmbedding: () => Promise.resolve(),
  loadExtraction: () => Promise.resolve([]),
  saveExtraction: () => Promise.resolve(),
};

export function createIndexedDatabaseQueueStorage(): QueueStorage {
  return {
    loadEmbedding: () => loadKey(KEY_EMBEDDING),
    saveEmbedding: (paths) => saveKey(KEY_EMBEDDING, paths),
    loadExtraction: () => loadKey(KEY_EXTRACTION),
    saveExtraction: (paths) => saveKey(KEY_EXTRACTION, paths),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('queue-storage: open failed'));
    });
  });
}

async function loadKey(key: string): Promise<NotePath[]> {
  try {
    const database = await openDatabase();
    return await new Promise<NotePath[]>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const request = store.get(key);
      request.addEventListener('success', () => {
        const value = request.result as unknown;
        if (Array.isArray(value)) {
          resolve(value.filter((entry): entry is string => typeof entry === 'string'));
          return;
        }
        resolve([]);
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('queue-storage: read failed'));
      });
    });
  } catch (error: unknown) {
    logError('memory/queue-storage-load', { key, error });
    return [];
  }
}

async function saveKey(key: string, paths: NotePath[]): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(paths, key);
      tx.addEventListener('complete', () => {
        resolve();
      });
      tx.addEventListener('error', () => {
        reject(tx.error ?? new Error('queue-storage: write failed'));
      });
    });
  } catch (error: unknown) {
    logError('memory/queue-storage-save', { key, error });
  }
}
