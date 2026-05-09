// GitHub App Device Flow implementation.
// Reference: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token
//
// CORS note: github.com's device-flow endpoints do not set Access-Control-Allow-Origin,
// so a browser SPA cannot call them directly. We route requests through a same-origin
// `/__gh` prefix which is proxied to github.com — by Vite in dev (see vite.config.ts),
// and by a first-party serverless function in production (Phase 11).
// See IMPLEMENTATION-PLAN §10 Decision Log + §11 Known Blockers.
//
// Note: we request no OAuth `scope`. GitHub App user access tokens derive their
// permissions from the App's installation on each repo; scopes are ignored.
const GH_PROXY_PREFIX = '/__gh';
const DEVICE_CODE_URL = `${GH_PROXY_PREFIX}/login/device/code`;
const TOKEN_URL = `${GH_PROXY_PREFIX}/login/oauth/access_token`;

// How many seconds to wait between polls when GitHub returns slow_down.
const SLOW_DOWN_EXTRA_SECONDS = 5;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface PollResponse {
  access_token?: string;
  // GitHub Apps with user-access expiration enabled return both of these
  // alongside `access_token`. They're absent for legacy/non-expiring tokens.
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  interval?: number;
}

// Result of a successful device flow / refresh exchange. expiresAt /
// refreshExpiresAt are absolute ms epochs so callers don't have to remember
// when they minted the token.
export interface AccessTokenResult {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!response.ok) {
    throw new Error(`Device code request failed: ${String(response.status)}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

async function pollOnce(clientId: string, deviceCode: string): Promise<PollResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token poll failed: ${String(response.status)}`);
  }

  return response.json() as Promise<PollResponse>;
}

function delay(seconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

function pollResponseToTokenResult(poll: PollResponse): AccessTokenResult | undefined {
  if (typeof poll.access_token !== 'string') return undefined;
  // GitHub Apps with token expiration disabled would omit refresh_token /
  // expires_in. We don't expect that configuration but guard anyway: fall
  // back to "lifetime" sentinels so callers can store something coherent.
  // Subtract a 60s safety buffer so we treat the token as expiring slightly
  // before GitHub does, avoiding races on 401-near-boundary.
  const SAFETY_BUFFER_MS = 60_000;
  const accessExpiresIn = poll.expires_in ?? 8 * 60 * 60;
  const refreshExpiresIn = poll.refresh_token_expires_in ?? 6 * 30 * 24 * 60 * 60;
  return {
    accessToken: poll.access_token,
    refreshToken: poll.refresh_token ?? '',
    accessExpiresAt: Date.now() + accessExpiresIn * 1000 - SAFETY_BUFFER_MS,
    refreshExpiresAt: Date.now() + refreshExpiresIn * 1000,
  };
}

/**
 * Runs the full GitHub App Device Flow.
 *
 * @param clientId     GitHub App client_id (public, safe to bundle; `Iv23li…` prefix).
 * @param onCode       Called once the device code is ready; show userCode to the user
 *                     and open verificationUri in a new tab.
 * @returns            The full token bundle (access + refresh + expiries).
 */
export async function runDeviceFlow(
  clientId: string,
  onCode: (userCode: string, verificationUri: string) => void,
): Promise<AccessTokenResult> {
  const codeResponse = await requestDeviceCode(clientId);
  onCode(codeResponse.user_code, codeResponse.verification_uri);

  let pollInterval = codeResponse.interval;
  const expiresAt = Date.now() + codeResponse.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await delay(pollInterval);

    const poll = await pollOnce(clientId, codeResponse.device_code);

    const result = pollResponseToTokenResult(poll);
    if (result !== undefined) return result;

    if (poll.error === 'slow_down') {
      // GitHub asks us to back off; increase the interval for subsequent polls.
      pollInterval += SLOW_DOWN_EXTRA_SECONDS;
    } else if (poll.error !== undefined && poll.error !== 'authorization_pending') {
      throw new Error(`Device flow error: ${poll.error}`);
    }
  }

  throw new Error('Device flow timed out — the user did not authorise in time');
}

/**
 * Exchanges a refresh token for a fresh access token + refresh token pair.
 * GitHub rotates the refresh token on every refresh, so callers must
 * persist the new bundle.
 *
 * Throws if the refresh token has expired or been revoked — caller should
 * clear local auth state and prompt the user to re-run the device flow.
 */
export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<AccessTokenResult> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${String(response.status)}`);
  }

  const poll = (await response.json()) as PollResponse;
  if (poll.error !== undefined) {
    throw new Error(`Token refresh error: ${poll.error}`);
  }
  const result = pollResponseToTokenResult(poll);
  if (result === undefined) {
    throw new Error('Token refresh returned no access_token');
  }
  return result;
}
