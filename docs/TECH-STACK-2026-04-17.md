# Open Brain — Tech Stack

**Date:** 2026-04-17
**Status:** Locked for MVP
**References:** [CONSTRAINTS-2026-04-17.md](./CONSTRAINTS-2026-04-17.md)

---

## Summary

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Framework | **Svelte 5** (via SvelteKit) |
| Router / App shell | **SvelteKit** with `adapter-static`, SSR off, SPA mode |
| Build tool | Vite (via SvelteKit) |
| Styling | **Tailwind CSS 4** |
| Editor | **CodeMirror 6** |
| LLM runtime | **WebLLM** (`@mlc-ai/web-llm`) |
| Embeddings | **Transformers.js** (`@xenova/transformers`) with `all-MiniLM-L6-v2` |
| Speech input | **Web Speech API** (abstracted via `Transcriber` interface) |
| Hashing | **Web Crypto** `subtle.digest` |
| Git in browser | **`isomorphic-git`** |
| Local filesystem for git | **`@isomorphic-git/lightning-fs`** on IndexedDB |
| Auth | **GitHub Device Flow** |
| PWA | **`@vite-pwa/sveltekit`** (Workbox under the hood) |
| Testing | **Vitest** (pure / functional modules only — no UI tests) |
| Lint | **ESLint flat config** — `typescript-eslint` strict + stylistic, `svelte`, `import-x`, `unicorn`, `promise` |
| Format | **Prettier** with `prettier-plugin-svelte` + `prettier-plugin-tailwindcss` |
| Single gate | **`npm run check`** — types, lint, format, tests in parallel; must pass before any task is done |

---

## Framework — Svelte 5 via SvelteKit

### Why Svelte 5
- User wants to learn it; great fit for a greenfield project.
- Runes (`$state`, `$derived`, `$effect`) give clean, explicit reactivity — well-suited to streaming chat UIs and debounced pipelines.
- Small bundle (~8 KB app shell) is a rounding error next to the Gemma model download.

### Why SvelteKit
- Svelte's official framework. Built-in file-based routing, code splitting, PWA plugin support.
- **TanStack Router for Svelte was evaluated and rejected** — pre-release / not stable enough for a new project.
- Configure as a pure SPA:
  - `adapter-static` (outputs a fully static site)
  - `export const ssr = false` at root
  - `export const prerender = true` at root
- Gives us: deep linking, back-button, shareable URLs for each tab (`/chat`, `/browse`, `/memory`, `/setup`).

### Coding style — readability first
Per project preference, Svelte code prioritizes **readability over cleverness**:
- Always use runes (`$state`, `$derived`, `$effect`) — never legacy reactivity.
- Prefer explicit named stores/state objects over inline `$state` where the thing is reused.
- Component files kept small; extract logic-heavy code into plain `.ts` modules and consume from components.
- Avoid magic reactivity chains — if a computation is non-trivial, make it a `$derived` with a clear name.

---

## Routing & App Shell

- **SvelteKit routes:**
  - `/` — redirect to `/chat` or `/setup` based on auth state
  - `/setup` — first-run: browser compatibility check, GitHub auth, repo selection, initial model download
  - `/chat` — Chat tab
  - `/browse` — Browse tab (file tree + editor)
  - `/browse/[...path]` — open a specific note
  - `/memory` — Memory tab
- Tabs are a persistent layout (`+layout.svelte`); the tab bar is a nav component.
- Offline behavior: all routes are prerendered static shells; SW hydrates from cache.

---

## Styling — Tailwind CSS 4

### Why Tailwind 4
- User wants to learn it; modern v4 is simpler than v3 (no config file required for many cases).
- Ships with the Vite plugin (`@tailwindcss/vite`) — zero PostCSS config.
- Design-token-friendly via `@theme` directive.

### Conventions
- Use Tailwind utilities in component markup.
- Extract repeated class groups to Svelte components, not to `@apply` — keeps CSS simple.
- Dark mode: system-preference default, with a manual toggle stored in local config.

---

## Editor — CodeMirror 6

### Why
- Plain-text markdown in MVP still needs:
  - Wikilink autocomplete (`[[note-name`)
  - Good mobile keyboard / IME handling
  - Line wrapping, large-document performance
- A `<textarea>` can't do autocomplete against a note index.
- CodeMirror 6 is modular — we pull only the extensions we need.

### Extensions enabled for MVP
- `@codemirror/lang-markdown` — syntax awareness (used for parsing, not visual highlighting in MVP)
- `@codemirror/autocomplete` — for wikilink completion
- `@codemirror/search` — in-note find
- Custom **wikilink extension** — detects `[[...]]`, offers completions from the vault's note list, renders the token as clickable in Browse view
- Mobile-friendly: no line numbers by default; soft-wrap on

### Constraint reminder
- Plain-text editing only for MVP. Rich rendering (preview pane, inline formatting) is post-MVP.

---

## AI Stack

### LLM — WebLLM
- Package: `@mlc-ai/web-llm`
- Supports Gemma variants out of the box; serves prebuilt MLC-compiled weights from HF / their CDN.
- Model swap is a runtime operation — no rebuild needed when user picks a variant.
- Handles WebGPU device detection and graceful errors.
- Exposes streaming token callbacks — wires cleanly to Svelte's `$state`.

### Embeddings — Transformers.js
- Package: `@xenova/transformers`
- Runs `all-MiniLM-L6-v2` via ONNX (WASM by default, WebGPU when available).
- Much cheaper than the LLM — runs comfortably on mobile.
- Note: when the embedding model runs alongside a large Gemma variant, memory pressure can be real. The LLM Runtime and Embedder must coordinate (see architecture doc).

### Speech — Web Speech API
- Wrapped in a **`Transcriber`** interface.
- MVP impl: `WebSpeechTranscriber`.
- Future impl: `WhisperTranscriber` (via `whisper.cpp` WASM) — see `docs/CONSTRAINTS-2026-04-17.md` §12.

---

## Storage Stack

### Git working copy — lightning-fs + isomorphic-git
- **`@isomorphic-git/lightning-fs`** provides a POSIX-ish filesystem backed by IndexedDB.
- **`isomorphic-git`** operates on that filesystem: `clone`, `pull`, `push`, `merge`, `diff`, `status`, `commit`.
- Enables true 3-way merge for conflict resolution (§6 of constraints).
- Works on all target browsers, including iOS Safari.

### Reads
- Notes are read on-demand from lightning-fs (no denormalized cache).
- Acceptable because: single-user, small vaults, IndexedDB is fast for reads.
- Revisit if profiling shows it's a bottleneck.

### Writes
- All writes go through the **Vault** abstraction → lightning-fs → isomorphic-git commit → push.

### Diff/merge
- 3-way merges handled by isomorphic-git's built-in merge driver.
- For the conflict-marker tier, we use the library's conflict output directly.
- For backup-file tier, just filesystem writes with a timestamped filename.

---

## Auth — GitHub Device Flow

### Why Device Flow
- Standard GitHub OAuth requires a `client_secret` that a static-hosted SPA cannot hold securely.
- Device Flow is designed for exactly this case: the user is shown a short code and visits `github.com/login/device` in another tab.
- No server component required.

### Flow
1. POST to `https://github.com/login/device/code` with our `client_id` + scopes (`repo`, `user:email`).
2. Display `user_code` + open `verification_uri` in a new tab.
3. Poll `https://github.com/login/oauth/access_token` with `device_code` until success.
4. Store access token encrypted at rest in IndexedDB (see note on encryption below).

### Token storage
- **MVP:** stored in IndexedDB (origin-scoped; same-origin JS has access).
- **Post-MVP:** wrap with WebAuthn-derived key for additional at-rest encryption.
- **CSP prevents** cross-origin scripts from reaching IndexedDB, and there is no third-party JS loaded (per constraints §7).

### Scopes
- `repo` — required to read/write a private repo.
- `user:email` — used only to display user's email in UI (not stored or transmitted elsewhere).

---

## PWA — `@vite-pwa/sveltekit`

- Wraps Workbox; integrates with SvelteKit's build.
- **Caching strategy:**
  - App shell (HTML/JS/CSS): precache, `stale-while-revalidate` for updates.
  - Model weights (WebLLM, embeddings): cached by WebLLM / Transformers.js using their own cache APIs (HTTP cache + IndexedDB-backed blob store). We do **not** precache these — too large.
  - GitHub API responses: never cached in SW.
- Manifest: icons, short name, theme colors, standalone display mode.

---

## Testing

### Vitest — pure / functional modules only
- Runs in a Node environment (no jsdom). We do **not** test Svelte components with Vitest.
- In-scope targets (100% on these is realistic):
  - Hashing
  - Sidecar parse/serialize
  - Wikilink extractor
  - Merge logic
  - Retrieval math (cosine, ranking, chunk budgeting)
  - Queue state machines
- Out-of-scope:
  - Svelte components / DOM
  - End-to-end browser flows
  - Real LLM inference quality (manual eval)
  - Real Web Speech accuracy (manual check per browser)

### No UI testing framework for MVP
- Playwright / Cypress / component-testing frameworks are **not** used.
- UI correctness is verified manually during development + a launch-prep smoke pass across supported browsers.
- Rationale: the UI surface is small (three tabs, one editor, one chat view), and the hard integrations (WebGPU, device flow, isomorphic-git) aren't amenable to reliable headless automation anyway. We'd spend more time wrestling test infra than preventing bugs.
- Revisit post-MVP if the UI grows.

---

## Dependencies (approximate top-level list)

### Production
```
svelte                          ^5
@sveltejs/kit                   ^2
@sveltejs/adapter-static        ^3
@vite-pwa/sveltekit             ^0.x
tailwindcss                     ^4
@tailwindcss/vite               ^4
codemirror                      ^6
@codemirror/lang-markdown       ^6
@codemirror/autocomplete        ^6
@codemirror/search              ^6
@mlc-ai/web-llm                 latest
@xenova/transformers            ^2
isomorphic-git                  ^1
@isomorphic-git/lightning-fs    ^4
diff3                           ^0.x    (backup for merge edge cases)
```

### Dev
```
typescript                                  ^5
vite                                        (via SvelteKit)
svelte-check                                ^4
vitest                                      ^2

eslint                                      ^9
typescript-eslint                           ^8     (strict + stylistic)
eslint-plugin-svelte                        ^2
eslint-plugin-import-x                      ^4
eslint-plugin-unicorn                       ^55
eslint-plugin-promise                       ^7

prettier                                    ^3
prettier-plugin-svelte                      ^3
prettier-plugin-tailwindcss                 ^0.x

npm-run-all2                                ^6
```

### Quality gate — `npm run check`
Single command, parallel, zero tolerance.
```
check        → run-p -lc check:*
check:types  → svelte-check --fail-on-warnings
check:lint   → eslint . --max-warnings=0
check:format → prettier --check .
check:test   → vitest run
```
No task in the implementation plan is considered complete until `npm run check` passes clean. Auto-fix helpers: `npm run fix` chains `eslint --fix` + `prettier --write`.

---

## Decisions explicitly deferred

- **State management library** — starting with plain Svelte runes + module-scoped stores. Revisit if the chat/sync/memory state entangles badly.
- **Error reporting / observability** — constraints forbid external telemetry. MVP uses local-only error log accessible from a hidden debug view. TBD whether to surface it in UI.
- **i18n** — English only for MVP.
- **Custom service worker logic** beyond `@vite-pwa/sveltekit` defaults — will add only if the default caching proves insufficient.
