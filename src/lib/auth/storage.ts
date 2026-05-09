// IndexedDB wrapper for persisting the GitHub App user-access bundle —
// access token, refresh token, and expiries. GitHub App user-access
// tokens are short-lived (~8h); the refresh token (~6mo) is what lets
// us bring the session back without forcing the user through the device
// flow on every visit.
//
// Store: openbrain-auth  |  Object store: tokens
// Key:   auth_bundle     →  AuthBundle (object)

const DB_NAME = 'openbrain-auth';
const STORE_NAME = 'tokens';
const AUTH_BUNDLE_KEY = 'auth_bundle';

export interface AuthBundle {
  accessToken: string;
  refreshToken: string;
  // ms epoch — when the access token stops being accepted.
  accessExpiresAt: number;
  // ms epoch — when the refresh token itself stops working. After this
  // the user has to re-run the device flow.
  refreshExpiresAt: number;
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
      reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
    });
  });
}

function isAuthBundle(value: unknown): value is AuthBundle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AuthBundle>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.accessExpiresAt === 'number' &&
    typeof candidate.refreshExpiresAt === 'number'
  );
}

export async function getAuthBundle(): Promise<AuthBundle | undefined> {
  const database = await openDatabase();

  return new Promise<AuthBundle | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(AUTH_BUNDLE_KEY);

    getRequest.addEventListener('success', () => {
      const value: unknown = getRequest.result;
      resolve(isAuthBundle(value) ? value : undefined);
    });

    getRequest.addEventListener('error', () => {
      reject(getRequest.error ?? new Error('Failed to read auth bundle'));
    });
  });
}

export async function setAuthBundle(bundle: AuthBundle): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const putRequest = store.put({ ...bundle }, AUTH_BUNDLE_KEY);

    putRequest.addEventListener('success', () => {
      resolve();
    });

    putRequest.addEventListener('error', () => {
      reject(putRequest.error ?? new Error('Failed to store auth bundle'));
    });
  });
}

export async function clearAuthBundle(): Promise<void> {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const deleteRequest = store.delete(AUTH_BUNDLE_KEY);

    deleteRequest.addEventListener('success', () => {
      resolve();
    });

    deleteRequest.addEventListener('error', () => {
      reject(deleteRequest.error ?? new Error('Failed to clear auth bundle'));
    });
  });
}

// Convenience getter for callers that don't care about expiry — returns
// just the access token if a bundle is stored.
export async function getAccessToken(): Promise<string | undefined> {
  const bundle = await getAuthBundle();
  return bundle?.accessToken;
}
