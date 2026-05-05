// IndexedDB wrapper for persisting the currently-cloned repo identity.
// Browse needs `{ owner, name }` to scope GitHub code-search queries; setup
// writes it on clone, the layout restores it on load.

const DB_NAME = 'openbrain-repo';
const STORE_NAME = 'repo';
const REPO_KEY = 'current';

export interface StoredRepo {
  owner: string;
  name: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, 1);

    openRequest.addEventListener('upgradeneeded', () => {
      openRequest.result.createObjectStore(STORE_NAME);
    });

    openRequest.addEventListener('success', () => {
      resolve(openRequest.result);
    });

    openRequest.addEventListener('error', () => {
      reject(openRequest.error ?? new Error('Failed to open repo IndexedDB'));
    });
  });
}

function isStoredRepo(value: unknown): value is StoredRepo {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { owner?: unknown; name?: unknown };
  return typeof candidate.owner === 'string' && typeof candidate.name === 'string';
}

export async function getStoredRepo(): Promise<StoredRepo | undefined> {
  const database = await openDatabase();

  return new Promise<StoredRepo | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(REPO_KEY);

    getRequest.addEventListener('success', () => {
      const value: unknown = getRequest.result;
      resolve(isStoredRepo(value) ? value : undefined);
    });

    getRequest.addEventListener('error', () => {
      reject(getRequest.error ?? new Error('Failed to read stored repo'));
    });
  });
}

export async function setStoredRepo(repo: StoredRepo): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const putRequest = store.put({ owner: repo.owner, name: repo.name }, REPO_KEY);

    putRequest.addEventListener('success', () => {
      resolve();
    });

    putRequest.addEventListener('error', () => {
      reject(putRequest.error ?? new Error('Failed to store repo'));
    });
  });
}

export async function clearStoredRepo(): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const deleteRequest = store.delete(REPO_KEY);

    deleteRequest.addEventListener('success', () => {
      resolve();
    });

    deleteRequest.addEventListener('error', () => {
      reject(deleteRequest.error ?? new Error('Failed to clear stored repo'));
    });
  });
}
