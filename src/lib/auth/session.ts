// Session manager: owns the in-flight GitHub auth bundle, refreshes it
// when nearing expiry, and exposes a single async getter the rest of the
// app uses to obtain a known-fresh access token.
//
// Why this lives outside `state.svelte.ts`: refresh involves async I/O
// against GitHub's token endpoint and IndexedDB, which doesn't fit the
// rune model cleanly. The state runes still reflect the latest token
// (so `engine.getToken()` keeps working), but persistence + refresh
// orchestration is centralised here.

import { logError } from '$lib/log';
import { auth } from '$lib/state.svelte';

import { refreshAccessToken, type AccessTokenResult } from './device-flow';
import { clearAuthBundle, getAuthBundle, setAuthBundle, type AuthBundle } from './storage';

// Refresh proactively when this much time remains before access-token
// expiry. 5 minutes is well clear of typical request latency and gives
// us margin on background tabs that wake up after a long sleep.
const PROACTIVE_REFRESH_MS = 5 * 60 * 1000;

let activeBundle: AuthBundle | undefined;
// Single-flight: if a refresh is already in progress, callers join it
// instead of issuing concurrent token-refresh requests (which would
// invalidate each other's refresh tokens — GitHub rotates them).
let inFlightRefresh: Promise<AuthBundle | undefined> | undefined;
let clientId: string | undefined;

export interface SessionInit {
  clientId: string;
}

/**
 * Hydrate the session from IndexedDB and proactively refresh if the
 * stored access token is expired or will expire soon. Should be called
 * once on app load before any GitHub-bound request fires.
 *
 * Returns the active bundle, or undefined if no session is stored or
 * the refresh token is itself expired (caller should treat as signed
 * out and prompt the user to re-authorise).
 */
export async function initSession(init: SessionInit): Promise<AuthBundle | undefined> {
  clientId = init.clientId;
  let stored: AuthBundle | undefined;
  try {
    stored = await getAuthBundle();
  } catch (error: unknown) {
    logError('auth/session-load', { error });
    return undefined;
  }
  if (stored === undefined) return undefined;

  // Refresh token itself dead → can't recover automatically.
  if (Date.now() >= stored.refreshExpiresAt) {
    await clearAuthBundle();
    return undefined;
  }

  activeBundle = stored;
  publish(stored);

  if (Date.now() >= stored.accessExpiresAt - PROACTIVE_REFRESH_MS) {
    const refreshed = await tryRefresh();
    return refreshed ?? stored;
  }
  return stored;
}

/**
 * Adopt a freshly-minted bundle (from the device flow). Persists, then
 * publishes to runes. Call after `runDeviceFlow` resolves on /setup.
 */
export async function adoptBundle(bundle: AccessTokenResult): Promise<void> {
  const stored: AuthBundle = { ...bundle };
  activeBundle = stored;
  await setAuthBundle(stored);
  publish(stored);
}

/**
 * Returns a known-fresh access token, refreshing if expiry is near.
 * Returns undefined when no session exists or refresh fails. Used by
 * API + git callers that always want the current token.
 */
export async function getValidAccessToken(): Promise<string | undefined> {
  const bundle = activeBundle;
  if (bundle === undefined) return undefined;

  if (Date.now() < bundle.accessExpiresAt - PROACTIVE_REFRESH_MS) {
    return bundle.accessToken;
  }
  const refreshed = await tryRefresh();
  return refreshed?.accessToken;
}

/**
 * Force a refresh now (used after a 401 from a GitHub call we believed
 * had a fresh token). Returns the new bundle, or undefined if refresh
 * failed — in which case the session has already been cleared and the
 * caller should surface a re-auth prompt.
 */
export async function forceRefresh(): Promise<AuthBundle | undefined> {
  return tryRefresh();
}

/**
 * Tear down the session entirely. Used by sign-out.
 */
export async function clearSession(): Promise<void> {
  resetActiveBundle();
  try {
    await clearAuthBundle();
  } catch (error: unknown) {
    logError('auth/session-clear', { error });
  }
}

// Returns the refreshed bundle, or undefined if refresh isn't possible
// or fails. Never throws — callers always get a clean fallback path.
// Single-flight via `inFlightRefresh` so concurrent callers join the
// same exchange (GitHub rotates the refresh token, so concurrent
// requests would invalidate each other).
async function tryRefresh(): Promise<AuthBundle | undefined> {
  if (inFlightRefresh !== undefined) return inFlightRefresh;
  const bundle = activeBundle;
  if (bundle === undefined) return undefined;
  if (clientId === undefined) return undefined;
  if (bundle.refreshToken === '') return undefined;
  const refreshClient = clientId;
  const refreshToken = bundle.refreshToken;

  inFlightRefresh = (async (): Promise<AuthBundle | undefined> => {
    try {
      const result = await refreshAccessToken(refreshClient, refreshToken);
      const next: AuthBundle = { ...result };
      activeBundle = next;
      await setAuthBundle(next);
      publish(next);
      return next;
    } catch (error: unknown) {
      logError('auth/refresh', { error });
      // Refresh token rejected — wipe so we don't loop on the same bad value.
      resetActiveBundle();
      try {
        await clearAuthBundle();
      } catch (clearError: unknown) {
        logError('auth/refresh-clear', { error: clearError });
      }
      return undefined;
    } finally {
      inFlightRefresh = undefined;
    }
  })();

  return inFlightRefresh;
}

function resetActiveBundle(): void {
  activeBundle = undefined;
  inFlightRefresh = undefined;
  // eslint-disable-next-line unicorn/no-useless-undefined -- explicit empty arg for the optional-bundle signature.
  publish(undefined);
}

function publish(bundle: AuthBundle | undefined): void {
  auth.token = bundle?.accessToken;
  // auth.user is set elsewhere (after we resolve /user); leave it alone.
}
