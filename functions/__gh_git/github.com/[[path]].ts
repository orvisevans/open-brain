// Cloudflare Pages Function — proxies `/__gh_git/github.com/*` → `github.com/*`
// for git smart-HTTP (`info/refs`, `git-upload-pack`, `git-receive-pack`).
//
// The path shape comes from isomorphic-git: it constructs fetch URLs as
//   `${corsProxy}/${url.replace(/^https?:\/\//, '')}`
// so with `corsProxy: '/__gh_git'` and a remote like
// `https://github.com/<owner>/<repo>.git`, the browser hits
// `/__gh_git/github.com/<owner>/<repo>.git/info/refs?...`. We strip both
// the prefix and the embedded `github.com` segment before forwarding.
//
// Git smart-HTTP uses chunked transfer encoding for `git-upload-pack` /
// `git-receive-pack` request bodies. `proxyTo` forwards `request.body`
// as-is, which Cloudflare streams to the upstream — no buffering needed.

import { proxyTo } from '../../_shared/proxy';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstreamPath = url.pathname.replace(/^\/__gh_git\/github\.com/, '');
  const upstreamUrl = `https://github.com${upstreamPath}${url.search}`;
  return proxyTo(upstreamUrl, context.request);
};
