import type { IncomingMessage } from 'node:http';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ProxyOptions } from 'vite';

// Dev-only same-origin proxy for GitHub OAuth device-flow endpoints.
// github.com does not set CORS headers on /login/device/code or
// /login/oauth/access_token, and the public cors.isomorphic-git.org proxy
// only allowlists git smart-HTTP paths (returns 403 on OAuth preflights).
// In dev, browser code hits /__gh/... same-origin and Vite forwards server-side.
// In production, a first-party proxy (Cloudflare Pages Function or similar)
// must serve the same path prefix — see IMPLEMENTATION-PLAN Phase 11.

// Strip `WWW-Authenticate: Basic ...` from upstream responses so the
// browser doesn't show a native credential prompt on git smart-HTTP 401s.
//
// Why this matters: git's authenticated smart-HTTP protocol relies on a
// two-step dance — first an unauth request to /info/refs, then a 401 +
// WWW-Authenticate: Basic, then isomorphic-git retries with onAuth-supplied
// HTTP Basic credentials. Same-origin 401 responses with WWW-Authenticate
// trigger the browser's built-in credential prompt before isomorphic-git
// gets a chance to retry, which is both confusing for the user and breaks
// the protocol. Stripping the header keeps the 401 status (so isomorphic-git's
// onAuth still fires) while preventing the browser dialog. The same logic
// applies to /__gh_api when the REST API rejects an expired token.
const stripBasicAuthChallenge: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyRes', (proxyRes: IncomingMessage) => {
    delete proxyRes.headers['www-authenticate'];
  });
};

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      // api.github.com → installation / user lookups (installations.ts).
      '/__gh_api': {
        target: 'https://api.github.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__gh_api/, ''),
        configure: stripBasicAuthChallenge,
      },
      // github.com → git smart-HTTP endpoints (/owner/repo.git/info/refs,
      // /git-upload-pack, etc.). isomorphic-git constructs fetch URLs as
      //   `${corsProxy}/${url.replace(/^https?:\/\//, '')}`
      // so `corsProxy: '/__gh_git'` + `https://github.com/owner/repo.git/...`
      // becomes `/__gh_git/github.com/owner/repo.git/...`. We strip both the
      // prefix and the embedded `github.com` segment before forwarding.
      '/__gh_git': {
        target: 'https://github.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__gh_git\/github\.com/, ''),
        configure: stripBasicAuthChallenge,
      },
      // github.com → OAuth / device-flow endpoints (/login/device/code, etc.).
      '/__gh': {
        target: 'https://github.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__gh/, ''),
      },
    },
  },
});
