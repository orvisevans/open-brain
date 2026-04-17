// GitHub OAuth Device Flow implementation.
// Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SCOPE = 'repo';

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
  error?: string;
  interval?: number;
}

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPE }),
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

/**
 * Runs the full GitHub Device Flow.
 *
 * @param clientId     GitHub OAuth App client_id (public, safe to bundle).
 * @param onCode       Called once the device code is ready; show userCode to the user
 *                     and open verificationUri in a new tab.
 * @returns            The access token once the user has authorised the device.
 */
export async function runDeviceFlow(
  clientId: string,
  onCode: (userCode: string, verificationUri: string) => void,
): Promise<string> {
  const codeResponse = await requestDeviceCode(clientId);
  onCode(codeResponse.user_code, codeResponse.verification_uri);

  let pollInterval = codeResponse.interval;
  const expiresAt = Date.now() + codeResponse.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await delay(pollInterval);

    const poll = await pollOnce(clientId, codeResponse.device_code);

    if (typeof poll.access_token === 'string') {
      return poll.access_token;
    }

    if (poll.error === 'slow_down') {
      // GitHub asks us to back off; increase the interval for subsequent polls.
      pollInterval += SLOW_DOWN_EXTRA_SECONDS;
    } else if (poll.error !== undefined && poll.error !== 'authorization_pending') {
      throw new Error(`Device flow error: ${poll.error}`);
    }
  }

  throw new Error('Device flow timed out — the user did not authorise in time');
}
