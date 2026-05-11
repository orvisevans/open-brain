// Cloudflare Pages Function — proxies `/__gh/*` → `github.com/*`.
//
// Used for GitHub OAuth device-flow (e.g. `/login/device/code`,
// `/login/oauth/access_token`). GitHub doesn't send CORS headers for these
// endpoints, so the browser code in `src/lib/auth` hits this same-origin
// proxy instead. Mirrors the Vite `server.proxy` config in `vite.config.ts`
// so swapping dev → production is purely a deploy concern, not a code change.

import { proxyTo } from '../_shared/proxy';

export interface PagesEnv {
  // Reserved for future env vars (e.g. an upstream override). Empty for MVP.
  readonly _?: never;
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  // `[[path]].ts` captures everything after `/__gh/`. Strip the prefix and
  // forward to github.com preserving query string.
  const upstreamPath = url.pathname.replace(/^\/__gh/, '');
  const upstreamUrl = `https://github.com${upstreamPath}${url.search}`;
  return proxyTo(upstreamUrl, context.request);
};
