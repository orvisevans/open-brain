// Cloudflare Pages Function — proxies `/__gh_api/*` → `api.github.com/*`.
//
// Used for REST API calls (installations, repositories, user). Same
// same-origin / CORS-avoidance rationale as `__gh`.

import { proxyTo } from '../_shared/proxy';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstreamPath = url.pathname.replace(/^\/__gh_api/, '');
  const upstreamUrl = `https://api.github.com${upstreamPath}${url.search}`;
  return proxyTo(upstreamUrl, context.request);
};
