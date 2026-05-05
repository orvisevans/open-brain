# Open Brain — MVP Implementation Plan

**Date:** 2026-04-17
**Status:** Active plan; resume across sessions by checking boxes
**References:** [CONSTRAINTS](./CONSTRAINTS-2026-04-17.md) · [TECH-STACK](./TECH-STACK-2026-04-17.md) · [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md) · [DESIGN](./DESIGN-2026-04-17.md)

---

## Resuming in a new session

1. Load the four docs above.
2. Run `git log --oneline -20` to see recent progress.
3. Open this file; find the first unchecked box.
4. If unsure, read the **Decision Log** (§10) and **Known Blockers** (§11) at the end of this doc.

When you complete a task, check the box and commit. Prefer atomic commits per task group (not per task).

## Definition of Done — every task

**No task is considered complete until `npm run check` passes clean.**

`npm run check` runs (in parallel): type check (`svelte-check`), lint (`eslint`), format verify (`prettier --check`), and unit tests (`vitest run`). A task is only done when all four pass with zero warnings tolerated.

If you touch code, you run `npm run check` before ticking the box. If the check surfaces issues in unrelated code, fix them or file a note in the Decision Log (§10); do not suppress or downgrade rules silently.

---

## Execution strategy

Build a **walking skeleton first** (Phase 1) — the thinnest possible slice that touches every hard integration end-to-end. This de-risks the integrations (WebGPU, isomorphic-git, device flow, WebLLM, Transformers.js) before investing in features.

After the skeleton is green, build vertically by feature, roughly in dependency order from the architecture doc.

---

## Phase 0 — Project scaffolding

### Project init
- [x] Initialize SvelteKit project (`npm create svelte@latest`); pick TypeScript, skip SSR-specific demo code
- [x] Configure SvelteKit for **static SPA mode**:
    - [x] Install `@sveltejs/adapter-static`
    - [x] `svelte.config.js`: set `adapter-static` with `fallback: 'index.html'`
    - [x] Root `+layout.ts`: `export const ssr = false; export const prerender = true;`

### TypeScript — strict
- [x] `tsconfig.json` extends SvelteKit base and layers on the strictest reasonable flags:
    - [x] `"strict": true`
    - [x] `"noUncheckedIndexedAccess": true`
    - [x] `"noImplicitOverride": true`
    - [x] `"noFallthroughCasesInSwitch": true`
    - [x] `"noPropertyAccessFromIndexSignature": true`
    - [x] `"exactOptionalPropertyTypes": true`
    - [x] `"verbatimModuleSyntax": true`
- [x] `svelte-check` runs clean against `src/`

### Linting — extremely opinionated
- [x] ESLint flat config (`eslint.config.js`) composing:
    - [x] `typescript-eslint` — `strictTypeChecked` + `stylisticTypeChecked`
    - [x] `eslint-plugin-svelte` — recommended + `@typescript-eslint` integration
    - [x] `eslint-plugin-import-x` — `recommended`, `typescript`; enforce ordered imports + no cycles
    - [x] `eslint-plugin-unicorn` — `recommended`; keep the opinionated lints (naming, filename conventions) on
    - [x] `eslint-plugin-promise` — `recommended`
- [x] Explicitly enabled rules beyond the recommended sets:
    - [x] `@typescript-eslint/no-floating-promises`: error
    - [x] `@typescript-eslint/no-misused-promises`: error
    - [x] `@typescript-eslint/consistent-type-imports`: error
    - [x] `@typescript-eslint/strict-boolean-expressions`: error
    - [x] `@typescript-eslint/no-unnecessary-condition`: error
    - [x] `@typescript-eslint/switch-exhaustiveness-check`: error
    - [x] `import-x/no-cycle`: error (depth: 3)
    - [x] `import-x/order`: error (groups: builtin, external, internal, parent, sibling, index)
    - [x] `no-console`: error (allow `console.error`, `console.warn` only via `logError` helper)
- [x] `eslint --max-warnings=0` on the whole repo passes
- [x] No rule is set to `"off"` or `"warn"` unless the reason is noted in the Decision Log (§10)

### Formatting — Prettier, opinionated and locked
- [x] Install `prettier`, `prettier-plugin-svelte`, `prettier-plugin-tailwindcss`
- [x] `.prettierrc` with explicit, locked choices:
    ```json
    {
      "printWidth": 100,
      "tabWidth": 2,
      "useTabs": false,
      "singleQuote": true,
      "quoteProps": "consistent",
      "trailingComma": "all",
      "semi": true,
      "bracketSpacing": true,
      "arrowParens": "always",
      "endOfLine": "lf",
      "plugins": ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"]
    }
    ```
- [x] `.prettierignore` covers `build/`, `.svelte-kit/`, `dist/`, `node_modules/`, lockfiles
- [x] `prettier --check .` passes repo-wide
- [x] Editor config (`.editorconfig`) aligns with the above so IDEs don't fight Prettier

### Testing — Vitest only (no UI tests)
- [x] Install `vitest`; configure for Node environment (no jsdom — we are not testing components)
- [x] Convention: **Vitest covers pure / functional modules only** — parsers, hashers, merge logic, retrieval math, queue state machines. UI is verified manually during implementation.
- [x] No Playwright / Cypress in this project. Component tests explicitly out of scope for MVP.
- [x] Add one placeholder test in `src/lib/__tests__/sanity.test.ts` that passes; confirms the runner works

### Tailwind 4
- [x] Install `tailwindcss` + `@tailwindcss/vite`
- [x] Wire Vite plugin in `vite.config.ts`
- [x] Add `@import "tailwindcss";` to root stylesheet
- [x] Define initial design tokens (`@theme`) from [DESIGN](./DESIGN-2026-04-17.md) §3 — placeholder hex values for `--bg`, `--fg`, `--accent`, `--border`, `--danger`, `--warn`, `--ok` in both light/dark
- [x] Set up `[data-theme]` + `prefers-color-scheme` CSS plumbing; no UI switcher yet

### The `check` script
- [x] Install `npm-run-all2`
- [x] `package.json` scripts:
    ```json
    {
      "check": "run-p -lc check:*",
      "check:types": "svelte-check --tsconfig ./tsconfig.json --fail-on-warnings",
      "check:lint": "eslint . --max-warnings=0",
      "check:format": "prettier --check .",
      "check:test": "vitest run",
      "fix": "run-s fix:*",
      "fix:lint": "eslint . --fix",
      "fix:format": "prettier --write ."
    }
    ```
- [x] `npm run check` passes clean on a fresh clone.
- [x] **This is the gate: no task below is considered done until `npm run check` passes.**

### CI & deploy
- [x] GitHub Actions workflow (`.github/workflows/ci.yml`): on push + PRs, run `npm ci && npm run check && npm run build`
- [ ] Deploy target picked and configured (default recommendation: **Cloudflare Pages**). Site reachable at a preview URL.
- [x] `README.md` at repo root: one-paragraph what-it-is + links to the docs

### End of phase
- [x] `npm run check` green
- [ ] Tag commit `phase-0-complete`
- [ ] Review Phase 1's tasks in light of what was learned during scaffolding; update this plan if anything changed (dep versions, script names, directory conventions)

---

## Phase 1 — Walking skeleton

Goal: one running app that proves every hard integration works. Ugly is fine. No styling beyond defaults.

### Routing & shell
- [x] Three routes: `/chat`, `/browse`, `/memory`, plus `/setup`
- [x] Root layout with a tab bar (top desktop / bottom mobile — crude, unstyled OK)
- [x] Active tab highlights on current route

### Auth (Device Flow)
- [x] Register a GitHub **App** (Device Flow enabled; installation-scoped). Store `client_id` in `.env` as `VITE_GITHUB_CLIENT_ID` (public, safe to bundle). See §10 2026-04-22 for the OAuth App → GitHub App rationale.
- [x] `auth/device-flow.ts`: POST device code, display `user_code` + open `verification_uri`, poll for token
- [x] On success: persist token to IndexedDB (`openbrain-auth` store, key `access_token`)
- [x] `/setup`: "Sign in with GitHub" button → runs the flow → shows current user login on success
- [x] After sign-in, auto-resolve target repo from `/user/installations` (see `src/lib/auth/installations.ts`); collapse clone step when there's a single installed repo

### Sync (minimal)
- [x] Install `isomorphic-git` + `@isomorphic-git/lightning-fs`
- [x] `/setup`: input field for repo `owner/name`; button to clone into lightning-fs
- [x] On successful clone, list repo files in `/browse` as plain `<ul>`

### LLM (minimal)
- [x] Install `@mlc-ai/web-llm`
- [x] `/setup`: "Load Gemma-1B" button → calls `CreateMLCEngine` with the smallest Gemma variant → shows load progress in status line
- [x] `/chat`: single `<input>` + `<button>`; on submit, call `engine.chat.completions.create` with streaming → append tokens to a `<pre>` element

### Embeddings (minimal)
- [x] Install `@xenova/transformers`
- [x] `/memory`: button "Embed a string" → embeds `"hello world"` using `all-MiniLM-L6-v2` → displays first 5 dimensions of the resulting vector

### Status bar (minimal)
- [x] Monospace bar at the bottom of every page showing: auth state (logged-in user or `not signed in`), model load state, an online/offline dot
- [x] Uses `navigator.onLine` + listeners for offline state

### Exit criteria
- [x] On a WebGPU-capable Chrome: sign in → clone a throwaway repo → load Gemma-1B → send one message and see tokens stream back → embed a string → see a vector. All without a reload.
- [x] `npm run check` green
- [x] Tag commit `walking-skeleton-green`
- [x] Review Phase 2's tasks against what the skeleton revealed; update if any integration detail differed from the sketch

---

## Phase 2 — Vault & Browse tab

### Vault module (`src/lib/vault/`)

Public path type is `NotePath` (repo-relative POSIX, e.g. `notes/foo.md`) per [ARCHITECTURE §3](./ARCHITECTURE-2026-04-17.md). The vault reuses the shared `fs = new LightningFS('openbrain-fs')` exported from `src/lib/sync/git.ts`, translating `NotePath` → `/repo/<path>` internally. No new lightning-fs instance is created, and no `$lib/polyfills` import is needed (vault is pure `fs.promises` + string manipulation).

- [x] `readNote(path: NotePath)` / `writeNote(path: NotePath, content: string)` via `fs.promises` on the shared `fs` from `$lib/sync/git`. `writeNote` `mkdir -p`s the parent directory (fresh repos have no `/repo/notes/` yet). Also added `readRaw(path)` returning verbatim file contents for the editor — see §10 2026-05-05.
- [x] `listNotes()` — recursive **fs-walk** under `/repo/notes/` via `fs.promises.readdir`. **Not** `gitListFiles` — new/unsaved notes must appear before they're committed.
- [x] `parseFrontmatter(content)` → `{ frontmatter, body }` — **handwritten** minimal parser (flat `key: value` + simple `key: [a, b, c]` lists). No `gray-matter` dep. Revisit in Phase 4 if sidecar frontmatter needs richer YAML.
- [x] `extractWikilinks(body, from: NotePath)` → `WikilinkReference[]` conforming to [ARCHITECTURE §3](./ARCHITECTURE-2026-04-17.md): supports `[[target]]` and `[[target|display]]`, returns `{ from, to, display? }`. Renamed from `WikilinkRef` to satisfy `unicorn/prevent-abbreviations`; see §10 2026-05-05.
- [x] All error paths route through `logError('vault/<op>', { ... })` (helper at `src/lib/log.ts`; already used elsewhere in the skeleton).
- [x] Unit tests colocated in `src/lib/vault/__tests__/` — pure, Node-env Vitest. Mock `fs.promises` with an in-memory shim; do **not** instantiate a real LightningFS in tests.

### Browse UI

The existing `src/routes/browse/+page.svelte` is a flat list of every tracked file from `listFiles()` — Phase 2 **replaces** it with a tree + editor layout; it is not extended.

- [x] Replace `/browse/+page.svelte` with a sidebar-tree + editor layout. Implemented as a `/browse/+layout.svelte` owning the sidebar, with the bare `/browse/+page.svelte` showing an empty state and the dynamic detail under `/browse/[...path]/+page.svelte`.
- [x] File tree component (recursive) reading from `listNotes()`; click opens note in editor. `FileTree.svelte` uses self-import (Svelte 5 deprecated `<svelte:self>`).
- [x] Route: `/browse/[...path]` opens a specific note. Bare `/browse` shows an empty state (or the most recently edited note).
- [x] CodeMirror 6 integration as a Svelte action:
    - [x] Install: `codemirror`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/search`, plus explicit peer deps `@codemirror/view`, `@codemirror/state`, `@codemirror/commands` (pin them to avoid duplicate-version hell)
    - [x] Wrapper component `Editor.svelte` — value in/out via props, runes-based
    - [x] Markdown language support enabled
    - [x] Soft-wrap on, no line numbers, mobile-friendly
- [x] **Wikilink autocomplete extension**
    - [x] Detect `[[` trigger; offer completions from `listNotes()`
    - [x] `[[target|display]]` syntax supported in the parser, autocomplete fills `target`
- [x] Autosave: on editor change, debounce ~3s then call `writeNote`. Use `just-debounce-it` (promoted to a direct dependency).
- [x] "New note" button: creates `notes/untitled-<timestamp>.md` and opens it. Relies on `writeNote`'s `mkdir -p` behavior for the first note on a fresh repo.

### GitHub full-text search
- [x] `/browse` has a search input
- [x] Add `repo: { owner: string; name: string } | undefined` rune to `src/lib/state.svelte.ts` (populated at clone time in setup; hydrated from IndexedDB on load). Required so Browse knows what repo to scope queries to. Persistence lives in `src/lib/sync/repo-storage.ts` (separate IndexedDB so we don't have to bump `openbrain-auth`'s schema version).
- [x] Online: `GET /__gh_api/search/code?q=<term>+repo:<owner>/<name>` with the stored device-flow token in `Authorization: Bearer …`. The `/__gh_api` same-origin proxy is already wired in `vite.config.ts`.
- [x] Offline (`!navigator.onLine`, or on 4xx/5xx): fall back to local substring search over `listNotes()` + `readNote`
- [x] Results list clickable → routes to `/browse/<path>`

### Exit criteria
- [ ] Can create, edit, and browse notes. Wikilink autocomplete works. Changes autosave to lightning-fs. _(Pending manual browser verification.)_
- [x] `npm run check` green
- [ ] Review Phase 3's tasks against what you learned about Vault API shape + CodeMirror integration; update if needed

---

## Phase 3 — Sync engine

Spec tightened post-Phase-2 review. Decisions captured below; rationale in §10 entry `2026-05-05 — Phase 3 spec review`.

### Sync module (`src/lib/sync/`)

The existing `src/lib/sync/git.ts` ships `cloneRepository()` only; Phase 3 adds the rest of the smart-HTTP surface. All ops share the same plumbing — extract a helper rather than copy-pasting `corsProxy: '/__gh_git'` + `onAuth: …` into each call site.

- [ ] `withGitDefaults(token: string)` helper inside `git.ts` that returns the common isomorphic-git options (`fs`, `http`, `dir: '/repo'`, `corsProxy: '/__gh_git'`, `onAuth`). Every new op (`commit`, `push`, `pull`, `status`, `add`) builds on it.
- [ ] `add(paths: NotePath[])` wrapper — stages files via `git.add` (per-path call; batched).
- [ ] `commit(paths: NotePath[], message: string)` wrapper. Author defaults to `{ name: auth.user ?? 'open-brain', email: 'noreply@open-brain.local' }` — see Decision Log. `message` defaults to `'open-brain: sync <ISO timestamp>'` when caller passes none.
- [ ] `push()` — uses `onAuth` for HTTP Basic; targets `refs/heads/main` (default GitHub branch for new repos). Document in Decision Log; revisit if a user reports `master`-only repos failing.
- [ ] `pull()` — fetch + merge. `singleBranch: true` to keep the working FS minimal. Merges return one of three outcomes consumed by the conflict tier dispatcher.
- [ ] `status(): Promise<{ path: NotePath; state: 'modified' | 'untracked' | 'deleted' }[]>` — wraps `git.statusMatrix` and projects it to the small shape we actually need.
- [ ] `SyncEngine` class in `src/lib/sync/engine.ts` exposing `SyncStatus` (per [ARCHITECTURE §3](./ARCHITECTURE-2026-04-17.md)) via a module-level `$state` rune (mirrors `state.svelte.ts` conventions).
- [ ] **Vault → Sync change notification.** Extend `createVault(fs, options)` to accept `options.onChange?: (path: NotePath) => void`. The production wiring in `src/lib/vault/index.ts` injects a callback that calls `syncEngine.notifyChange(path)`. Tests still pass nothing.
- [ ] **Debounce:** SyncEngine debounces **from the last vault `onChange` call**, not from last keystroke. Editor's 3s + Sync's 5s stack on purpose: the cap on time-to-GitHub for a fresh edit is ~8s. Document the budget; do not collapse the debounces.
- [ ] During the debounce window, accumulate changed paths in a Set. On window expiry: stage all → commit single squashed commit → push.
- [ ] Status bar wires to `SyncStatus`: `▲ synced Xs ago` / `◆ N pending` / `○ offline` / `◇ syncing`. Add a fourth segment to `+layout.svelte`'s status bar (currently auth | model | network).

### Conflict resolution — three tiers

Tier 2's "resolver UI" was hand-wavy; concretized below.

- [ ] **Tier 1:** 3-way auto-merge via isomorphic-git's merge driver on pull. On clean merge, push the merge commit immediately.
- [ ] **Tier 2:** Detect overlap → isomorphic-git writes conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) into the affected files → emit `{ kind: "conflict", paths }` on `SyncStatus`.
    - [ ] Resolver UI: render conflict markers **inline in the existing CodeMirror editor** as decorated regions with a small overlay button group (`keep ours` / `keep theirs` / `edit manually`) per hunk. Avoid a separate diff route — keep the user in the editor they already have open. New extension at `src/lib/browse/conflict-overlay.ts`.
    - [ ] On resolve action, mutate the document to remove the markers, save through the vault, and commit. SyncEngine pushes on the next debounce cycle.
- [ ] **Tier 3:** On merge-engine failure (i.e., isomorphic-git throws), write `<path>.conflict-<ISO>.md` with the local version, take remote as canonical for `<path>`, commit both, surface a toast (toast component is Phase 9 — for Phase 3 use a banner in the status bar).

### Testing

Vitest cannot drive a real GitHub remote. Split the test surface explicitly:

- [ ] **Unit tests** (Vitest): SyncEngine queue/debounce state machine, conflict-tier dispatcher, `status()` projection. Mock at the `git.ts` wrapper layer — define `GitOps` interface, inject a fake. Do NOT mock isomorphic-git itself (too large, too many entry points).
- [ ] **Manual e2e** (browser): two-profile editing; offline → online resume; conflict-tier-2 happy path. Capture results in this section as checked boxes when verified.

### Exit criteria
- [ ] Edits sync to GitHub automatically.
- [ ] Editing the same note on two devices (simulate via two browser profiles) results in: auto-merge if non-overlapping; resolver UI if overlapping; backup file if the engine blows up.
- [ ] `npm run check` green
- [ ] Review Phase 4's tasks against what you learned about sync timing and conflict flows; update queue/debounce assumptions if they clash with reality

---

## Phase 4 — Memory pipeline

### Embedder (`src/lib/embed/`)
- [ ] Wrapper around `@xenova/transformers` with `all-MiniLM-L6-v2`
- [ ] `embed(texts: string[]): Promise<Float32Array[]>`
- [ ] Batched (max 8 per call)
- [ ] Chunking helper: split markdown body on `##` headings; fallback to 400-token window

### Sidecar I/O (`src/lib/memory/sidecar.ts`)
- [ ] `readSidecar(notePath)` from `.memory/<path>` via Vault
- [ ] `writeSidecar(sidecar)` — markdown with YAML frontmatter per [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md) §3
- [ ] `schema_version: 1` for MVP; reject/rebuild if mismatch
- [ ] Embeddings stored inline in frontmatter as base64-encoded `Float32Array`s

### Hash invalidation
- [ ] `hashContent(content)` via Web Crypto `subtle.digest('SHA-256', ...)` → hex
- [ ] `isSidecarFresh(note, sidecar)` → boolean

### Queues (`src/lib/memory/queues.ts`)
- [ ] **Embedding queue** — debounced (30s idle after last edit)
    - [ ] Persisted to `openbrain-queues` IndexedDB store so it survives reload
    - [ ] Processes: read note → chunk → embed changed chunks → write sidecar
- [ ] **LLM extraction queue** — lazy
    - [ ] Idle-gated: only runs when no user input for 2min (listen to `pointermove`/`keydown`)
    - [ ] Battery-gated on mobile: check `navigator.getBattery()`; pause if `<50%` and not charging
    - [ ] Processes: read note → ask Gemma for `{summary, entities, facts, topics}` via a fixed prompt → write sidecar
    - [ ] **`GpuLease`** single-slot lock shared with LLMRuntime so chat takes priority
- [ ] "Refresh memory" button in Memory tab triggers queue flush regardless of gates

### Memory tab UI
- [ ] List of notes with their sidecar status (fresh / stale / missing / queued)
- [ ] Click a note → see its extracted summary, entities, facts, topics, links
- [ ] Queue status chip: `3 notes pending index`
- [ ] "Refresh memory" button

### Exit criteria
- [ ] Creating/editing a note generates a sidecar within 30s (embeddings) and eventually gets LLM-extracted when idle.
- [ ] Sidecars round-trip through sync (so a second device inherits them).
- [ ] `npm run check` green
- [ ] Review Phase 5's tasks against what you learned about retrieval quality and sidecar shape; adjust top-K default, chunking strategy, or context budget if needed

---

## Phase 5 — Chat & retrieval

### LLM Runtime polish (`src/lib/llm/`)
- [ ] `LLMRuntime` class with `loadModel`, `unloadModel`, `chat`, `currentVariant`
- [ ] Model selection UI on `/setup` and in settings: Gemma variants with download sizes + VRAM estimates
- [ ] Download progress in status bar (`gemma-4b loading 43%`)
- [ ] Model cached across sessions (WebLLM handles this)

### Transcriber (`src/lib/transcribe/`)
- [ ] `Transcriber` interface per architecture §6
- [ ] `WebSpeechTranscriber` implementation
- [ ] Capability check: `isAvailable()` returns false on unsupported browsers

### Retrieval (`src/lib/memory/retrieve.ts`)
- [ ] `retrieve(query: string, k=5)` → `{ chunks, noteRefs }`
- [ ] Embed query, load all sidecar embeddings, cosine-rank, return top-K
- [ ] Assemble context prompt per architecture §10
- [ ] Budget chunks to ~70% of Gemma context window

### Chat UI
- [ ] Message list (user + assistant, streaming-aware)
- [ ] Text input with terminal-style blinking cursor (respects `prefers-reduced-motion`)
- [ ] Mic button calling `Transcriber` (hidden if `isAvailable() === false`)
- [ ] Show "based on: note A, note B" on each assistant message (links to notes)
- [ ] Chat history persisted in `openbrain-chat` IndexedDB store (not synced)
- [ ] `/chat` loads the last N messages on mount

### Exit criteria
- [ ] Ask Gemma a question about a note you wrote; it retrieves relevant context and answers with citations.
- [ ] Voice input works on supported browsers; gracefully hidden on others.
- [ ] `npm run check` green
- [ ] Review Phase 6's tasks; attachments may need to coordinate with sync flows you've now built, adjust accordingly

---

## Phase 6 — Attachments

- [ ] `AttachmentStore` interface per architecture §6
- [ ] `GitHubRepoAttachments` impl: reads/writes under `attachments/`
- [ ] Drag-and-drop on the editor → stores blob → inserts Markdown image/link
- [ ] Attachments sync as part of the normal commit flow

### Exit criteria
- [ ] Attaching a file from any tab works; it ends up in `attachments/` and renders when referenced in a note.
- [ ] `npm run check` green
- [ ] Review Phase 7's setup flow; add/remove steps based on real first-run behavior of the features you've built

---

## Phase 7 — First-run setup & compat

### Compat detection (`src/lib/compat/`)
- [ ] Detect WebGPU, Web Speech API, IndexedDB/OPFS availability, rough VRAM
- [ ] `getCapabilities()` returns a typed struct

### Setup flow
- [ ] `/setup` becomes a multi-step flow:
    1. Compatibility matrix (✅/⚠️/❌ per feature on current browser)
    2. Sign in with GitHub
    3. Pick existing private repo OR create new one (`gh`-style name input)
    4. First clone (progress)
    5. Pick Gemma variant (skip if no WebGPU; user can use the app without Chat)
    6. Initial model download
    7. "You're set up" → redirect to `/chat`
- [ ] If auth/repo already set, `/` redirects straight to `/chat`

### Browser compatibility page
- [ ] Standalone `/compat` route with the full matrix + guidance for each browser
- [ ] Linked from error states when a feature is unavailable

### Exit criteria
- [ ] A fresh user on a clean browser can complete the setup flow end-to-end.
- [ ] `npm run check` green
- [ ] Review Phase 8's design pass against the UI you've actually built; prune tasks that no longer apply, add any that emerged

---

## Phase 8 — Design pass

Run against [DESIGN](./DESIGN-2026-04-17.md). This is a pass, not a rebuild.

- [ ] Pick final accent hex (cyan vs magenta). Lock it in `@theme`.
- [ ] Theme switcher UI in settings (System / Light / Dark)
- [ ] Theme persisted to `.openbrain/config.json` (syncs across devices)
- [ ] Status bar polish — monospace, glyphs, click-to-detail per design §6
- [ ] Focus rings: phosphor glow on `:focus-visible`
- [ ] Terminal-style blinking cursor on chat input
- [ ] Optional scan-line overlay component, enabled on model-download + initial-clone screens only, toggle in settings
- [ ] Command palette (`Cmd/Ctrl+K`) — stub OK for MVP (just open notes by name)
- [ ] Typography pass: Inter + JetBrains Mono self-hosted, correct `font-feature-settings`
- [ ] Cross-check every interactive element for visible focus
- [ ] Sweep for any motion that ignores `prefers-reduced-motion`

### Exit criteria
- [ ] Visual pass complete; app feels like the design doc describes.
- [ ] `npm run check` green
- [ ] Review Phase 9's error/loading/a11y tasks against the now-themed UI; some may be redundant, others may have surfaced

---

## Phase 9 — Errors, loading, accessibility

### Loading (design §8)
- [ ] Under-150ms operations: no indicator
- [ ] 150ms–1s: optimistic UI
- [ ] 1s–10s: inline skeletons (Chat streams tokens; Browse shows note skeleton)
- [ ] >10s: explicit progress UI with readable status line

### Errors (design §9)
- [ ] Silent retry with exponential backoff for transient network
- [ ] GitHub rate-limit backoff with countdown in status bar
- [ ] Inline banners for auth-expired / model-load-failed
- [ ] Toast component: bottom-center desktop, top mobile; 6s auto-dismiss; duplicate collapse (×N)
- [ ] `console.error` structured logging helper: `logError(code, context)`
- [ ] `?debug=1` or key-chord → hidden debug panel showing recent errors

### Accessibility (design §10)
- [ ] Keyboard nav: all actions reachable; tab order matches visual order
- [ ] ARIA tablist on the three-tab bar
- [ ] Live region announces toasts and streaming responses
- [ ] Contrast audit: AAA body, AA everywhere
- [ ] Zoom to 200% — layout holds
- [ ] Axe / Lighthouse a11y score ≥ 95

### Exit criteria
- [ ] Every error path has been exercised manually at least once.
- [ ] `npm run check` green
- [ ] Review Phase 10's PWA tasks against what's now wired up; caching strategy may need tweaks based on actual asset sizes

---

## Phase 10 — PWA & offline

- [ ] Install `@vite-pwa/sveltekit`; configure manifest (name, icons, theme color, standalone)
- [ ] App shell precached via Workbox
- [ ] All routes render offline (compat page shows clear "offline" state when GitHub is unreachable)
- [ ] Lighthouse PWA audit passes
- [ ] Test: airplane mode → app still loads → Chat works → Browse works → sync queues changes → come back online → sync flushes

### Exit criteria
- [ ] App installs as PWA on mobile and desktop; offline-first experience feels seamless.
- [ ] `npm run check` green
- [ ] Review Phase 11's launch prep; add browser-specific gotchas discovered during PWA work

---

## Phase 11 — Launch prep

- [ ] Manual smoke test on each supported browser per `compat` matrix — capture which features work where
- [ ] Security: CSP headers configured (no inline scripts except WebLLM's required worker blob); no third-party JS in network panel
- [ ] Performance: measure time-to-first-token and initial-clone time for a 100-note repo; document baseline
- [ ] README: full user-facing getting-started
- [ ] `CONTRIBUTING.md` (optional for MVP)
- [ ] Register production GitHub App; swap `VITE_GITHUB_CLIENT_ID` from dev to prod. Install on a production repo to verify the installation-discovery flow works end-to-end.
- [ ] **Port the three same-origin proxies to the production host.** Dev uses Vite's `server.proxy` config; production needs serverless functions (Cloudflare Pages Functions or equivalent) at the same three paths: `/__gh/*` → `github.com/*`, `/__gh_api/*` → `api.github.com/*`, `/__gh_git/github.com/*` → `github.com/*`. No code in `src/` should need to change — the path prefixes are already in place. Verify via DevTools that every GitHub-bound request in production is same-origin.
- [ ] Tag `v0.1.0-mvp` and deploy to production URL

### Exit criteria
- [ ] `npm run check` green
- [ ] MVP is live, reachable, and actually usable as a personal second brain.

---

## 10. Decision Log

Record non-obvious decisions made during implementation that future sessions shouldn't have to re-derive.

> Format: `YYYY-MM-DD — decision — why`

- `2026-04-17` — `streamChat` in `src/lib/llm/runtime.ts` accepts `ChatCompletionMessageParam[]` (the WebLLM union type) directly rather than a simpler local type. Phase 5 should verify the full union is correct when tool-call messages are added.
- `2026-04-17` — `unicorn/no-nested-ternary` conflicts with Prettier (Prettier removes parentheses around nested ternaries). Resolution: use `$derived.by(() => { if … })` pattern in Svelte components instead of nested ternaries. Applied in the root layout.
- `2026-04-17` — `$app/*` and `$env/*` are SvelteKit virtual modules with no filesystem path; `import-x/resolver-next` (TypeScript resolver) cannot resolve them. Added `ignore: [String.raw\`^\$app/\`, String.raw\`^\$env/\`]` to `import-x/no-unresolved` globally.
- `2026-04-17` — isomorphic-git is imported via named exports (`clone`, `listFiles`) rather than the default export to satisfy `import-x/no-named-as-default-member`.
- `2026-04-17` — `LightningFS.FS` satisfies isomorphic-git's `CallbackFsClient` structurally (all callback-style methods match). No type assertion needed. Verified by TypeScript passing without warnings.
- `2026-04-17` — ESLint rule disables, enumerated for policy compliance (the plan requires every `off`/`warn` to have a Decision Log entry):
  - `unicorn/no-useless-undefined`: `off` for `**/*.svelte` and `**/*.svelte.ts`. Svelte 5's generated/runtime patterns use explicit `undefined` in places this rule flags but the author cannot refactor.
  - `@typescript-eslint/no-unused-expressions`: `off` for `src/**/*.{test,spec}.ts`. Some assertion shapes register as unused-expressions to the base rule; Vitest idioms would be unreadable if refactored to satisfy it.
  - `import-x/no-named-as-default` / `import-x/no-named-as-default-member`: `off` for root JS config files (`*.config.{js,mjs,cjs}`, `svelte.config.js`, `eslint.config.js`). `typescript-eslint` and `eslint-plugin-import-x` deliberately ship both a default and identically-named named exports — their own docs use the `import pkg from 'pkg'; pkg.configs.x` pattern these rules flag.
- `2026-04-17` — `check:types` runs `svelte-kit sync && svelte-check ...`, a superset of the plan's original snippet. `svelte-kit sync` is required on fresh clones (and after route changes) to regenerate `.svelte-kit/ambient.d.ts`; without it `$app/*` and `$env/*` imports fail type-checking. Functionally equivalent behaviour to the snippet, with a stability fix.
- `2026-04-17` — ~~**CORS / GitHub proxy via `cors.isomorphic-git.org`.**~~ Superseded by the 2026-04-22 entry below; kept for history. (Original approach relied on a third-party proxy that 403'd the OAuth device-flow endpoints — those are not on its allowlist.)
- `2026-04-22` — **GitHub auth reworked end-to-end.** Four coordinated changes, all driven by actually wiring up the skeleton's sign-in + clone path and finding the 2026-04-17 plan's assumptions off:
  1. **OAuth App → GitHub App.** The plan originally specified an OAuth App with `repo` scope. Switched to a GitHub App (`client_id` prefix `Iv23li…`) because it is installation-scoped: the user selects a specific repo to install on, and the resulting user access token can only reach that repo. This is both a security win (blast radius ≈ one repo instead of "every repo the user can touch") and a UX win — after sign-in we read `GET /user/installations{/id}/repositories` and auto-resolve the notes repo, collapsing step 2 of setup when there is exactly one installation. New helper at `src/lib/auth/installations.ts`. Device-flow request no longer sends an OAuth `scope` param (GitHub Apps derive permissions from the installation, not scopes).
  2. **Third-party proxy → same-origin Vite proxy.** The `cors.isomorphic-git.org` public proxy only allowlists git smart-HTTP paths (`/info/refs`, `/git-upload-pack`, `/git-receive-pack`) and returns 403 on OAuth device-flow preflights. Replaced with three same-origin prefixes in `vite.config.ts`: `/__gh` → `github.com` (device flow), `/__gh_api` → `api.github.com` (installations), `/__gh_git` → `github.com` (git smart-HTTP). Production will mirror these as serverless functions in Phase 11 — the prefix scheme was chosen to make that a drop-in swap.
  3. **Git auth: `Authorization: token <pat>` → `onAuth` HTTP Basic.** The plan's snippet used `headers: { Authorization: 'token ${token}' }`. That form is for the REST API; git smart-HTTP rejects it with 401. isomorphic-git's `onAuth: () => ({ username: 'x-access-token', password: token })` constructs HTTP Basic auth, which is what git-over-HTTPS expects. (GitHub smart-HTTP always 401s the first unauth `/info/refs`, then the client retries with Basic — this is the protocol, not a bug.)
  4. **`Buffer` polyfill for browser.** isomorphic-git 1.37.x uses Node's `Buffer` global in ~40 places (index serialization, tree writes, SHA-1 hex↔binary). Upstream expects consumers to polyfill `Buffer` in browsers. Added `src/lib/polyfills.ts` which assigns `globalThis.Buffer` from the `buffer` npm package, and `src/lib/sync/git.ts` side-effect-imports it before its isomorphic-git imports.

  Net effect: sign-in + clone both work same-origin, with per-repo-scoped tokens, and no third-party host in the auth/sync path. §11 blocker removed.
- `2026-04-22` — **Phase 2 spec tightened after walking-skeleton review.** Vault reuses the shared `fs` from `$lib/sync/git` and exposes `NotePath` (repo-relative) while translating to `/repo/…` internally. `listNotes()` fs-walks (via `fs.promises.readdir`) rather than calling `gitListFiles` so unsaved notes appear. Frontmatter: handwritten parser, no `gray-matter` dep, until Phase 4 forces richer YAML. Debounce: `just-debounce-it` promoted from transitive lockfile entry to a direct dependency. CodeMirror peer deps (`view`/`state`/`commands`) listed explicitly to prevent duplicate-version issues. `repo: { owner, name }` rune added to `state.svelte.ts` so Browse's GitHub code search can scope queries. The existing `/browse/+page.svelte` (flat list of tracked files) is **replaced** in Phase 2, not extended.
- `2026-05-05` — **Phase 2 implementation notes.**
  1. **Vault depends on a `FsLike` interface, not on `LightningFS` directly.** The vault module declares a small `fs.promises` subset (`src/lib/vault/fs-like.ts`) and accepts it via `createVault(fs)`. Production wires the shared LightningFS in `src/lib/vault/index.ts`; tests pass a pure in-memory shim (`__tests__/mem-fs.ts`). Avoids dragging IndexedDB into the Node-env Vitest runner.
  2. **Vault exposes `readRaw(path)` alongside `readNote(path)`.** `readNote` returns parsed `{ content: body, frontmatter }` for structured access (used by Phase 4 sidecar pipelines); `readRaw` returns the verbatim file string for the editor, where re-serialising frontmatter would risk lossy round-trips through our minimal parser. The `/browse/[...path]` route uses `readRaw`.
  3. **Type renames for lint compliance.** `WikilinkRef` → `WikilinkReference`, parser literals `null`/`~` map to `undefined` (not `null`) — both forced by `unicorn/prevent-abbreviations` and `unicorn/no-null` respectively. ARCHITECTURE-2026-04-17.md still uses `WikilinkRef`; treat the implementation name as canonical.
  4. **CodeMirror's autocomplete API requires `null`** (the `CompletionResult | null` union is part of its contract). `unicorn/no-null` is suppressed file-locally in `src/lib/browse/wikilink-completion.ts` via a single block-level `eslint-disable` comment, not in eslint config.
  5. **PascalCase Svelte filenames are now allowed by lint.** Added `unicorn/filename-case: ['error', { cases: { kebabCase: true, pascalCase: true } }]` to the Svelte block in `eslint.config.js`. Justification: PascalCase is the conventional Svelte component naming and is consistent with how the components are imported. Plain `.ts`/`.svelte.ts` files keep the kebab-only default.
  6. **Repo identity persisted in a separate IndexedDB** (`openbrain-repo`) rather than adding a new object store to `openbrain-auth`. Avoids a `version: 1 → 2` migration on existing installs. Setup writes on clone, layout hydrates on mount.
  7. **Search returns a tagged array** (`SearchResult` extends `SearchHit[]` with a `source: 'github' | 'local'` discriminator). The UI surfaces which path served the results so users know if they're seeing GitHub-indexed or fresh-local hits.
- `2026-05-05` — **Phase 3 spec review (pre-implementation).** Concrete decisions resolved before starting Phase 3:
  1. **Vault → Sync notification mechanism: optional `onChange` callback in `VaultOptions`.** Avoids global event-bus spaghetti; the production `vault/index.ts` injects the SyncEngine's `notifyChange` at construction. Tests remain pure (no callback wired).
  2. **Author identity for `git.commit()`:** `{ name: auth.user ?? 'open-brain', email: 'noreply@open-brain.local' }`. We deliberately did NOT request the GitHub `user:email` scope — the GitHub App device-flow token doesn't grant it — so we synthesize a no-reply email. The `name` falls back to the GitHub login (always available). Phase 8 settings will let users override.
  3. **Branch hardcoded to `main`.** GitHub default for new repos since 2020. Older `master` repos won't sync — document in §11 if anyone hits this; revisit only on report.
  4. **Stacked debounces are intentional.** Editor's 3s + Sync's 5s = ~8s max from last keystroke to GitHub. Stacking the two windows lets each layer's "idle" detection do its own job (typing pause vs file-system-quiet pause). Do not collapse to a single timer.
  5. **Test split:** Vitest unit-tests at the `GitOps` wrapper layer (mock `git.ts`'s public functions, not isomorphic-git itself); browser-driven manual e2e for real network. The `git.ts` wrapper becomes the seam for both.
  6. **Conflict resolver UI lives in the existing CodeMirror editor**, not a separate diff route. New extension `conflict-overlay.ts` decorates `<<<<<<< / ======= / >>>>>>>` ranges and renders inline action buttons. Keeps users in the file they already opened.
  7. **Status bar gets a 4th segment** for sync (`▲ synced 4s ago` etc). Did not fold sync into the network dot — they convey orthogonal information (you can be online but mid-conflict; offline but with no pending changes).

---

## 11. Known Blockers / Risks

Track things that might require a plan revision.

- ~~**CORS proxy for GitHub traffic is a third-party public endpoint.**~~ Resolved 2026-04-22 — see §10. All GitHub traffic now goes through same-origin Vite proxies (`/__gh`, `/__gh_api`, `/__gh_git`). Phase 11 production work is to replicate the same three proxy routes as serverless functions on the deploy target; no token or clone payload transits a third-party host in dev or prod.

---

## 12. Out of scope for MVP

Already covered in [CONSTRAINTS §11](./CONSTRAINTS-2026-04-17.md), restated so this plan is self-contained:

- Real-time collaboration
- Server-side AI
- Non-GitHub auth
- Native mobile apps
- Plugin system
- Rich markdown rendering
- Voice output (TTS)
- AAAK / lossy compression
- User-selectable embedding model
- External attachment storage (Dropbox, S3)

---

## 13. Post-MVP backlog (unordered)

Filed here so ideas that surface during MVP work don't get lost.

- [ ] Whisper transcription as a privacy/accuracy mode
- [ ] Voice output for conversational chat
- [ ] Rich markdown preview
- [ ] External attachment storage via `AttachmentStore` abstraction
- [ ] AAAK render-at-retrieval experiment (only if vault size demands)
- [ ] Plugin system
- [ ] Graph view / backlinks panel
- [ ] WebAuthn-encrypted token storage
