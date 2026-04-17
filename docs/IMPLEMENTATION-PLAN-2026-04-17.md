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
- [ ] Initialize SvelteKit project (`npm create svelte@latest`); pick TypeScript, skip SSR-specific demo code
- [ ] Configure SvelteKit for **static SPA mode**:
    - [ ] Install `@sveltejs/adapter-static`
    - [ ] `svelte.config.js`: set `adapter-static` with `fallback: 'index.html'`
    - [ ] Root `+layout.ts`: `export const ssr = false; export const prerender = true;`

### TypeScript — strict
- [ ] `tsconfig.json` extends SvelteKit base and layers on the strictest reasonable flags:
    - [ ] `"strict": true`
    - [ ] `"noUncheckedIndexedAccess": true`
    - [ ] `"noImplicitOverride": true`
    - [ ] `"noFallthroughCasesInSwitch": true`
    - [ ] `"noPropertyAccessFromIndexSignature": true`
    - [ ] `"exactOptionalPropertyTypes": true`
    - [ ] `"verbatimModuleSyntax": true`
- [ ] `svelte-check` runs clean against `src/`

### Linting — extremely opinionated
- [ ] ESLint flat config (`eslint.config.js`) composing:
    - [ ] `typescript-eslint` — `strictTypeChecked` + `stylisticTypeChecked`
    - [ ] `eslint-plugin-svelte` — recommended + `@typescript-eslint` integration
    - [ ] `eslint-plugin-import-x` — `recommended`, `typescript`; enforce ordered imports + no cycles
    - [ ] `eslint-plugin-unicorn` — `recommended`; keep the opinionated lints (naming, filename conventions) on
    - [ ] `eslint-plugin-promise` — `recommended`
- [ ] Explicitly enabled rules beyond the recommended sets:
    - [ ] `@typescript-eslint/no-floating-promises`: error
    - [ ] `@typescript-eslint/no-misused-promises`: error
    - [ ] `@typescript-eslint/consistent-type-imports`: error
    - [ ] `@typescript-eslint/strict-boolean-expressions`: error
    - [ ] `@typescript-eslint/no-unnecessary-condition`: error
    - [ ] `@typescript-eslint/switch-exhaustiveness-check`: error
    - [ ] `import-x/no-cycle`: error (depth: 3)
    - [ ] `import-x/order`: error (groups: builtin, external, internal, parent, sibling, index)
    - [ ] `no-console`: error (allow `console.error`, `console.warn` only via `logError` helper)
- [ ] `eslint --max-warnings=0` on the whole repo passes
- [ ] No rule is set to `"off"` or `"warn"` unless the reason is noted in the Decision Log (§10)

### Formatting — Prettier, opinionated and locked
- [ ] Install `prettier`, `prettier-plugin-svelte`, `prettier-plugin-tailwindcss`
- [ ] `.prettierrc` with explicit, locked choices:
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
- [ ] `.prettierignore` covers `build/`, `.svelte-kit/`, `dist/`, `node_modules/`, lockfiles
- [ ] `prettier --check .` passes repo-wide
- [ ] Editor config (`.editorconfig`) aligns with the above so IDEs don't fight Prettier

### Testing — Vitest only (no UI tests)
- [ ] Install `vitest`; configure for Node environment (no jsdom — we are not testing components)
- [ ] Convention: **Vitest covers pure / functional modules only** — parsers, hashers, merge logic, retrieval math, queue state machines. UI is verified manually during implementation.
- [ ] No Playwright / Cypress in this project. Component tests explicitly out of scope for MVP.
- [ ] Add one placeholder test in `src/lib/__tests__/sanity.test.ts` that passes; confirms the runner works

### Tailwind 4
- [ ] Install `tailwindcss` + `@tailwindcss/vite`
- [ ] Wire Vite plugin in `vite.config.ts`
- [ ] Add `@import "tailwindcss";` to root stylesheet
- [ ] Define initial design tokens (`@theme`) from [DESIGN](./DESIGN-2026-04-17.md) §3 — placeholder hex values for `--bg`, `--fg`, `--accent`, `--border`, `--danger`, `--warn`, `--ok` in both light/dark
- [ ] Set up `[data-theme]` + `prefers-color-scheme` CSS plumbing; no UI switcher yet

### The `check` script
- [ ] Install `npm-run-all2`
- [ ] `package.json` scripts:
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
- [ ] `npm run check` passes clean on a fresh clone.
- [ ] **This is the gate: no task below is considered done until `npm run check` passes.**

### CI & deploy
- [ ] GitHub Actions workflow (`.github/workflows/ci.yml`): on push + PRs, run `npm ci && npm run check && npm run build`
- [ ] Deploy target picked and configured (default recommendation: **Cloudflare Pages**). Site reachable at a preview URL.
- [ ] `README.md` at repo root: one-paragraph what-it-is + links to the docs

### End of phase
- [ ] `npm run check` green
- [ ] Tag commit `phase-0-complete`
- [ ] Review Phase 1's tasks in light of what was learned during scaffolding; update this plan if anything changed (dep versions, script names, directory conventions)

---

## Phase 1 — Walking skeleton

Goal: one running app that proves every hard integration works. Ugly is fine. No styling beyond defaults.

### Routing & shell
- [ ] Three routes: `/chat`, `/browse`, `/memory`, plus `/setup`
- [ ] Root layout with a tab bar (top desktop / bottom mobile — crude, unstyled OK)
- [ ] Active tab highlights on current route

### Auth (Device Flow)
- [ ] Register a GitHub OAuth App (Device Flow enabled). Store `client_id` as a build-time constant (public, safe).
- [ ] `auth/device-flow.ts`: POST device code, display `user_code` + open `verification_uri`, poll for token
- [ ] On success: persist token to IndexedDB (`openbrain-auth` store, key `access_token`)
- [ ] `/setup`: "Sign in with GitHub" button → runs the flow → shows current user login on success

### Sync (minimal)
- [ ] Install `isomorphic-git` + `@isomorphic-git/lightning-fs`
- [ ] `/setup`: input field for repo `owner/name`; button to clone into lightning-fs
- [ ] On successful clone, list repo files in `/browse` as plain `<ul>`

### LLM (minimal)
- [ ] Install `@mlc-ai/web-llm`
- [ ] `/setup`: "Load Gemma-1B" button → calls `CreateMLCEngine` with the smallest Gemma variant → shows load progress in status line
- [ ] `/chat`: single `<input>` + `<button>`; on submit, call `engine.chat.completions.create` with streaming → append tokens to a `<pre>` element

### Embeddings (minimal)
- [ ] Install `@xenova/transformers`
- [ ] `/memory`: button "Embed a string" → embeds `"hello world"` using `all-MiniLM-L6-v2` → displays first 5 dimensions of the resulting vector

### Status bar (minimal)
- [ ] Monospace bar at the bottom of every page showing: auth state (logged-in user or `not signed in`), model load state, an online/offline dot
- [ ] Uses `navigator.onLine` + listeners for offline state

### Exit criteria
- [ ] On a WebGPU-capable Chrome: sign in → clone a throwaway repo → load Gemma-1B → send one message and see tokens stream back → embed a string → see a vector. All without a reload.
- [ ] `npm run check` green
- [ ] Tag commit `walking-skeleton-green`
- [ ] Review Phase 2's tasks against what the skeleton revealed; update if any integration detail differed from the sketch

---

## Phase 2 — Vault & Browse tab

### Vault module (`src/lib/vault/`)
- [ ] `readNote(path)` / `writeNote(path, content)` over lightning-fs
- [ ] `listNotes()` — recursive walk under `notes/`
- [ ] `parseFrontmatter(content)` → `{ frontmatter, body }`; use `gray-matter` or a minimal handwritten parser
- [ ] `extractWikilinks(body)` → `WikilinkRef[]` (per architecture §3)
- [ ] Unit tests for all of the above (these are pure; lightning-fs mocked in-memory)

### Browse UI
- [ ] File tree component (recursive) reading from `listNotes()`; click opens note in editor
- [ ] Route: `/browse/[...path]` opens a specific note
- [ ] CodeMirror 6 integration as a Svelte action:
    - [ ] Install `codemirror`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/search`
    - [ ] Wrapper component `Editor.svelte` — value in/out via props, runes-based
    - [ ] Markdown language support enabled
    - [ ] Soft-wrap on, no line numbers, mobile-friendly
- [ ] **Wikilink autocomplete extension**
    - [ ] Detect `[[` trigger; offer completions from `listNotes()`
    - [ ] `[[target|display]]` syntax supported in the parser, autocomplete fills `target`
- [ ] Autosave: on editor change, debounce ~3s then call `writeNote`
- [ ] "New note" button: creates `notes/untitled-<timestamp>.md` and opens it

### GitHub full-text search
- [ ] `/browse` has a search input
- [ ] Online: query GitHub Search API (`search/code`) scoped to the user's repo
- [ ] Offline: fall back to local substring search over `listNotes()` + `readNote`
- [ ] Results list clickable → opens note

### Exit criteria
- [ ] Can create, edit, and browse notes. Wikilink autocomplete works. Changes autosave to lightning-fs.
- [ ] `npm run check` green
- [ ] Review Phase 3's tasks against what you learned about Vault API shape + CodeMirror integration; update if needed

---

## Phase 3 — Sync engine

### Sync module (`src/lib/sync/`)
- [ ] `commit(paths, message)` wrapper
- [ ] `push()` — uses the stored OAuth token for HTTP auth
- [ ] `pull()` — fetches, merges
- [ ] `status()` — returns list of changed/untracked paths
- [ ] `SyncEngine` class exposing `SyncStatus` as a Svelte store (rune-backed)
- [ ] Debounced auto-sync: coalesce edits from Vault into commits every ~5s idle
- [ ] Status bar wires to `SyncStatus`: `▲ synced Xs ago` / `◆ N pending` / `○ offline` / `◇ syncing`

### Conflict resolution — three tiers
- [ ] **Tier 1:** 3-way auto-merge via isomorphic-git's merge driver on pull
- [ ] **Tier 2:** Detect overlap → leave conflict markers in file → emit `{ kind: "conflict" }` status
    - [ ] Resolver UI: side-by-side or inline with "keep ours" / "keep theirs" / "edit manually" per conflict block
    - [ ] On resolve, commit the resolved file
- [ ] **Tier 3:** On merge-engine failure, write `<path>.conflict-<ISO>.md` with the local version, take remote as canonical, commit both, toast the user

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
- [ ] Register production GitHub OAuth App; swap `client_id` from dev to prod
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

---

## 11. Known Blockers / Risks

Track things that might require a plan revision.

- _(empty — add entries as work progresses)_

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
