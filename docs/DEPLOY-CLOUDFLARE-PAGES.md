# Deploying Open Brain to Cloudflare Pages

This is the production deploy target for Open Brain MVP. Cloudflare Pages serves the static SPA build and runs the three same-origin proxies as Pages Functions, all from one origin. Free tier covers personal use.

## Why Cloudflare Pages (not GitHub Pages)

The auth + sync path requires three same-origin proxies (`/__gh`, `/__gh_api`, `/__gh_git`) because GitHub doesn't send CORS headers for OAuth device flow or git smart-HTTP. GitHub Pages is static-only and can't run these. Cloudflare Pages bundles static hosting with Functions on the same origin, which is the minimum viable change from the existing Vite dev setup.

Alternatives considered: Netlify (functions paywall past 125K/mo), Vercel (similar tier), a separate Cloudflare Worker fronting the static site (more moving parts).

## Architecture overview

```
Browser → cloudflare-pages-domain
            ├── /                  → static SPA (svelte-kit adapter-static build)
            ├── /_app/immutable/* → hashed assets (1y cache)
            ├── /__gh/*           → Function: proxies github.com (OAuth device flow)
            ├── /__gh_api/*       → Function: proxies api.github.com (REST)
            └── /__gh_git/*       → Function: proxies github.com (git smart-HTTP)
```

The browser never talks to `github.com` directly. Every GitHub-bound request lands on the Pages origin first, which forwards to GitHub server-side. No third-party CORS proxy.

## One-time setup

### 1. Create the production GitHub App

1. Visit https://github.com/settings/apps/new
2. Name: `Open Brain` (or your fork's name)
3. Homepage URL: your Cloudflare Pages domain (you'll fill this after deploy)
4. Webhook: disable
5. **Permissions** — Repository:
   - Contents: Read & write
   - Metadata: Read-only
6. Where can this app be installed: **Only on this account** (or **Any account** if you want others to use your deploy)
7. Save. Note the `Client ID` (starts with `Iv23li...`).

### 2. Create the Cloudflare Pages project

1. Visit https://dash.cloudflare.com → Pages → Create a project → Connect to Git
2. Pick this repo, branch `main`
3. Build settings:
   - Framework preset: SvelteKit
   - Build command: `npm run build`
   - Build output directory: `build`
4. Environment variables (Production + Preview):
   - `VITE_GITHUB_CLIENT_ID` = your production GitHub App's Client ID
5. Deploy.

The first deploy will fail to build until the env var is set — Cloudflare exposes a preview URL on retry.

### 3. Point the GitHub App at the deployed URL

Once the Pages project gives you a URL (e.g. `open-brain.pages.dev`), go back to the GitHub App settings and set the Homepage URL accordingly. Install the app on the private repo you want to use as your vault.

### 4. Verify same-origin

Open DevTools → Network on your Pages URL. Sign in. Confirm every request prefixed `https://github.com/...` or `https://api.github.com/...` appears as a same-origin request to your Pages domain (`open-brain.pages.dev/__gh/...`). If a direct `github.com` request shows up, the proxies aren't doing their job.

## Local development with Wrangler (optional)

Vite's dev server (`npm run dev`) handles the proxies via `server.proxy` config — that's the primary local loop. If you want to verify the Cloudflare Functions match Vite's behavior before deploying:

```bash
npm install --save-dev wrangler
npm run build
npx wrangler pages dev build --compatibility-date=2024-01-01
```

This runs the same Functions in a local Cloudflare-shaped sandbox. Use it as a pre-deploy sanity check, not as your daily dev loop.

## File layout

```
functions/
  _shared/proxy.ts                 # Shared upstream-forward helper
  __gh/[[path]].ts                 # → github.com (OAuth)
  __gh_api/[[path]].ts             # → api.github.com (REST)
  __gh_git/github.com/[[path]].ts  # → github.com (git smart-HTTP)
static/
  _headers                         # Cache + CSP rules served by Pages
```

## Notes on the CSP

The Content-Security-Policy in `static/_headers` carves out `wasm-unsafe-eval` for WebLLM and `blob:` for the Workers it spawns. There is no `unsafe-inline` for scripts. If you add a third-party JS dependency that requires it (don't), the CSP needs explicit hashes or nonces — keep the policy tight.

## Open items (filed for the launch phase, not blocking the scaffold)

- Tag `v0.1.0-mvp` on a green CI build before flipping production traffic.
- Add a minimal `manifest.json` for "Add to Home Screen" on mobile.
- Measure time-to-first-token + initial-clone latency on the deployed URL.
- README pass for end-user "fork → deploy → sign in" instructions.
