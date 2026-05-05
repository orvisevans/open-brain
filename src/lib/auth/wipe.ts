// Sign-out wipe: erase every IndexedDB database the app owns EXCEPT the
// WebLLM model cache, which is large (1+ GB) and reusable across logins.
//
// Why we delete entire databases rather than clearing object stores: it's
// the simplest way to guarantee no stale state survives, including any
// future stores we forget to enumerate. Deleting an in-use database can
// hang on some browsers, so the caller should reload the page immediately
// after `wipeLocalData()` resolves to drop any open handles.

import { logError } from '$lib/log';

// Databases we own. WebLLM's model cache uses its own naming convention
// (currently `webllm/<model>` and similar) and is intentionally absent.
const APP_DATABASES = ['openbrain-fs', 'openbrain-auth', 'openbrain-repo'];

function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => {
      resolve();
    });
    request.addEventListener('error', () => {
      logError('auth/wipe-db-error', { name, error: request.error });
      // Resolve anyway — a missing/locked db shouldn't block sign-out.
      resolve();
    });
    request.addEventListener('blocked', () => {
      logError('auth/wipe-db-blocked', { name });
      // Other tabs holding the db open will block the delete; we still
      // resolve so the caller can reload and let the OS clean up.
      resolve();
    });
  });
}

export async function wipeLocalData(): Promise<void> {
  await Promise.all(APP_DATABASES.map((name) => deleteDatabase(name)));
}
