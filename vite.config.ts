import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ProxyOptions } from 'vite';

// Path to isomorphic-git's pure-ESM entry. We can't reach it through any
// package-resolution API: the package's `exports` field exposes neither
// `./index.js` nor `./package.json`, so `createRequire.resolve` and
// `import.meta.resolve` both fail with "Package subpath ... is not
// defined by exports". The file is at a known location in node_modules,
// so we point Vite straight at it. If the dependency layout ever
// changes (e.g. a hoisted monorepo install), this needs adjusting.
const isomorphicGitEsm = fileURLToPath(
  new URL('./node_modules/isomorphic-git/index.js', import.meta.url),
);

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
  // isomorphic-git's package.json `exports["."]` only defines a
  // `default: ./index.cjs` (CommonJS, uses node:crypto's `createHash`).
  // Without an `import` condition, even ESM consumers in browsers
  // resolve to the CJS build, which crashes in Chromium with
  // `crypto$1.createHash is not a function`. The package ships a
  // pure-JS ESM build at `index.js` that uses `sha.js` for SHA-1 —
  // alias bare `isomorphic-git` imports straight to its absolute path.
  // (Safari happens to tolerate the broken resolution in some bundling
  // paths but Chromium does not.)
  resolve: {
    alias: [
      // Array form so we can use a regex `find`. Vite's record form does
      // exact-match against the literal key (the `$` suffix isn't
      // honoured the way it is in webpack), which means the bare
      // specifier `isomorphic-git` would not be matched.
      { find: /^isomorphic-git$/, replacement: isomorphicGitEsm },
    ],
  },
  server: {
    // Don't trigger HMR / full reloads on documentation or agent-config
    // changes. None of these paths are imported by the app, so edits to
    // them should never restart the dev server. Vite merges this with its
    // own defaults (node_modules, .git).
    watch: {
      ignored: ['**/docs/**', '**/*.md', '**/.claude/**', '**/.cursor/**'],
    },
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
