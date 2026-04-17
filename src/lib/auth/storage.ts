// IndexedDB wrapper for persisting the GitHub OAuth access token.
// Store: openbrain-auth  |  Object store: tokens

const DB_NAME = 'openbrain-auth';
const STORE_NAME = 'tokens';
const ACCESS_TOKEN_KEY = 'access_token';

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
      reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
    });
  });
}

export async function getAccessToken(): Promise<string | undefined> {
  const database = await openDatabase();

  return new Promise<string | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(ACCESS_TOKEN_KEY);

    getRequest.addEventListener('success', () => {
      const value: unknown = getRequest.result;
      resolve(typeof value === 'string' ? value : undefined);
    });

    getRequest.addEventListener('error', () => {
      reject(getRequest.error ?? new Error('Failed to read access token'));
    });
  });
}

export async function setAccessToken(token: string): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const putRequest = store.put(token, ACCESS_TOKEN_KEY);

    putRequest.addEventListener('success', () => {
      resolve();
    });

    putRequest.addEventListener('error', () => {
      reject(putRequest.error ?? new Error('Failed to store access token'));
    });
  });
}

export async function clearAccessToken(): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const deleteRequest = store.delete(ACCESS_TOKEN_KEY);

    deleteRequest.addEventListener('success', () => {
      resolve();
    });

    deleteRequest.addEventListener('error', () => {
      reject(deleteRequest.error ?? new Error('Failed to clear access token'));
    });
  });
}
