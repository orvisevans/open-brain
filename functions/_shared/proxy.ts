// Shared proxy helper for the three GitHub-side functions.
//
// Forwards request to `upstream`, strips a small set of headers that don't
// translate across hostname boundaries (`host`, `origin`), removes
// `WWW-Authenticate` from the response so browsers don't pop the native
// auth dialog on every 401 (git smart-HTTP's `/info/refs` returns 401 by
// design on the first request — isomorphic-git's `onAuth` then retries
// with Basic). Streams both request and response bodies so git's chunked
// transfer encoding works without buffering.
//
// Mirrors `stripBasicAuthChallenge` from `vite.config.ts` — keep the two
// in lock-step when changing header rules.

const HEADERS_TO_STRIP_FROM_REQUEST = new Set([
  'host',
  'origin',
  'cf-connecting-ip',
  'cf-ipcountry',
]);
const HEADERS_TO_STRIP_FROM_RESPONSE = new Set(['www-authenticate']);

export async function proxyTo(upstreamUrl: string, incoming: Request): Promise<Response> {
  const forwardHeaders = new Headers();
  for (const [name, value] of incoming.headers.entries()) {
    if (HEADERS_TO_STRIP_FROM_REQUEST.has(name.toLowerCase())) continue;
    forwardHeaders.set(name, value);
  }

  const init: RequestInit = {
    method: incoming.method,
    headers: forwardHeaders,
    // Don't follow redirects automatically — the browser should see them.
    redirect: 'manual',
  };
  // GET / HEAD bodies are not allowed.
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    init.body = incoming.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'upstream fetch failed';
    return new Response(JSON.stringify({ error: 'proxy-upstream-failed', detail: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers.entries()) {
    if (HEADERS_TO_STRIP_FROM_RESPONSE.has(name.toLowerCase())) continue;
    responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
