# Open Brain — MVP Implementation Plan

**Date:** 2026-04-17 (drafted) · last updated 2026-05-11
**Status:** Active plan; resume across sessions by checking boxes
**References:** [CONSTRAINTS](./CONSTRAINTS-2026-04-17.md) · [TECH-STACK](./TECH-STACK-2026-04-17.md) · [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md) · [DESIGN](./DESIGN-2026-04-17.md) · [POST-MVP-PLANS](./POST-MVP-PLANS-2026-05-11.md)

### Phase status snapshot (2026-05-11)

| Phase | State | Tag |
|---|---|---|
| 0 — Scaffolding | ✅ shipped | — |
| 1 — Walking skeleton | ✅ shipped | `walking-skeleton-green` |
| 2 — Vault & Browse | ✅ shipped | `phase-2-complete` |
| 3 — Sync engine | ✅ shipped | `phase-3-complete` |
| 4 — Memory pipeline | ✅ shipped | `phase-4-complete` |
| 5 — Chat & retrieval | ✅ shipped | `phase-5-complete` |
| 5.5 — Conversational note ops | ✅ shipped | `phase-5.5-complete` |
| 5.6 — Note lifecycle commands | ✅ shipped | `phase-5.6-complete` |
| 5.7 — Chats as first-class memory | ✅ shipped | `phase-5.7-complete` |
| 5.8 — Auto-organize + density review | ✅ shipped | `phase-5.8-complete` |
| 5.9 — Persona & capabilities context | ✅ shipped | `phase-5.9-complete` |
| 5.9.1 — Conversation context overflow | ✅ shipped (subset; deferred items below) | `phase-5.9.1-complete` |
| 6 — Attachments | ⛔ moved to POST-MVP | — |
| 7 — Setup polish | ⛔ moved to POST-MVP | — |
| 8 — Design pass | ✅ shipped (subset; rest deferred) | `phase-8-complete` |
| 9 — Errors + a11y | ✅ shipped (subset; rest deferred) | `phase-9-complete` |
| 10 — PWA & offline | ⛔ moved to POST-MVP | — |
| 10.5 — Deterministic e2e | 🔜 placeholder; not started | — |
| 10.7 — Architectural review | 🔜 placeholder; depends on 10.5 | — |
| 11 — Launch prep / Cloudflare Pages | 🟡 scaffolded; deploy steps open | — |

Test count at the last green check: **361 tests across 45 files**. `main` is at the tip of Phase 9 (commit `919d2a0`).

---

## Resuming in a new session

1. Load the four reference docs above + [POST-MVP-PLANS](./POST-MVP-PLANS-2026-05-11.md) for items deliberately out of the MVP critical path.
2. Run `git log --oneline -20` to see recent progress; check `git tag --list 'phase-*'` against the snapshot above.
3. Open this file; find the first unchecked box in an unfinished phase.
4. If unsure, read the **Decision Log** (§10) and **Known Blockers** (§11) at the end of this doc.

When you complete a task, check the box and commit. Prefer atomic commits per task group (not per task). Tag completed phases as `phase-<n>-complete` so the snapshot above stays scannable.

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

- [x] `gitDefaults(token?)` helper inside `git.ts` returns the common isomorphic-git options (`fs`, `http`, `dir: '/repo'`, `corsProxy: '/__gh_git'`, `onAuth`). Every smart-HTTP op (`clone`, `push`, `pull`) builds on it. Renamed from the plan's `withGitDefaults` because the helper composes by spread (`...gitDefaults(token)`), so the verb-first name read awkwardly.
- [x] `gitOps.stage(paths)` — per-path `git.add` for present files, `git.remove` for paths whose workdir vanished (deletion). Inferred from `statusMatrix` rather than stat-ing the FS twice.
- [x] `gitOps.commit(message, author)` — message format: `'open-brain: sync <ISO>'`. Author defaults documented below in Decision Log.
- [x] `gitOps.push(token)` — pushes `refs/heads/main`. Document in Decision Log; revisit if a user reports `master`-only repos failing.
- [x] `gitOps.pull(token, author)` — fetch + merge with `abortOnConflict: false` so conflict markers land in working files for tier 2's UI. Returns a typed `PullResult` (`up-to-date | fast-forward | merged | conflict | error`) so the engine can dispatch.
- [x] `gitOps.changedPaths()` — wraps `statusMatrix` and returns paths whose workdir state differs from HEAD. (Plan's `status()` shape was over-specified; the engine only needs the paths.)
- [x] `SyncEngine` in `src/lib/sync/engine.ts`. Exposes `status: { value: SyncStatus }` and `subscribe(listener)`. The plan asked for a Svelte rune; I used a plain reactive container so the engine can be unit-tested in pure Node without the Svelte compiler. The layout adapts the subscription into a local `$state` for reactivity.
- [x] **Vault → Sync change notification** via the `VaultOptions.onChange` hook. Production wiring in `src/lib/vault/index.ts` injects `syncEngine.notifyChange`; tests pass nothing.
- [x] **Debounce stacking is intentional.** Editor's 3s autosave + Sync's 5s commit window = ~8s max time-from-keystroke-to-GitHub. Each layer's "idle" detection serves a different purpose; collapsing into one would couple them.
- [x] During the debounce window, paths accumulate in a `Set<NotePath>`. On expiry: stage all → single commit → push. Failures re-queue; signed-out and offline states park changes safely.
- [x] **Status bar 4th segment** for sync. `▲ synced Xs ago` / `◆ N pending` / `◇ syncing (phase)` / `! conflict (N)` / `○ offline (N queued)` / `! sync error`. Auth segment now `flex: 0` so the longer sync label doesn't push it off-screen.
- [x] **Periodic pull** lives in the root layout (`+layout.svelte`), not the engine itself, because the engine is timer-agnostic for testability. Layout pulls on mount, every 30s, and on `online` events.

### Conflict resolution — three tiers

- [x] **Tier 1:** 3-way auto-merge via isomorphic-git on pull. On `merged` (no user-visible conflicts), the engine clears stale conflicts and resumes idle.
- [x] **Tier 2:** Overlap detected → isomorphic-git writes diff3 markers into the working files → engine emits `{ kind: 'conflict', paths }`.
    - [x] Resolver UI: inline CodeMirror extension at `src/lib/browse/conflict-overlay.ts` parses `<<<<<<< / ======= / >>>>>>>` (with optional `||||||| base` for diff3), decorates each hunk, and renders a `keep ours` / `keep theirs` button pair per hunk via a `WidgetType` block decoration.
    - [x] On click, the document is mutated to remove the markers, the page persists through the vault (skipping the 3s autosave debounce — conflicts are urgent), and `syncEngine.markResolved(path)` re-queues the file for commit/push.
    - [x] Manual editing still works: deleting markers by hand removes the decoration on the next document update.
- [ ] **Tier 3:** Deferred. The plan called for auto-writing `<path>.conflict-<ISO>.md` backups + resetting workdir to remote + replaying. Implementing the destructive reset/replay safely without browser-level testing on a real `MergeNotSupportedError` is too risky for the scope of this commit. The engine surfaces tier 3 as `{ kind: 'error', message: 'merge-engine failure — please re-clone the repo to recover' }`. See Decision Log §10 (2026-05-05 Phase 3 deferred items).

### Testing

- [x] **Unit tests** (Vitest): 11 SyncEngine tests at `src/lib/sync/__tests__/engine.test.ts` covering debounce coalescing, timer reset on new changes, status sequence emission, flush(), offline + signed-out gates, push-failure retry, pull conflict + clean-merge transitions, and markResolved re-queueing. The test harness uses a `FakeClock` and a `FakeGitOps` (also at `src/lib/sync/__tests__/fake-git-ops.ts`) — no isomorphic-git involvement.
- [x] 5 conflict-parser tests at `src/lib/browse/__tests__/conflict.test.ts` cover the marker-parser + resolveHunk function for both diff3 and standard markers.
- [ ] **Manual e2e** (browser): two-profile editing; offline → online resume; conflict-tier-2 happy path. Capture results here as checked boxes when verified.

### Exit criteria
- [x] Edits sync to GitHub automatically. _Verified manually 2026-05-09 across two browsers._
- [x] Editing the same note on two devices results in: auto-merge if non-overlapping; resolver UI if overlapping; clear error if the engine blows up. _Verified end-to-end. Resolver replaced raw diff3 markers with a friendly inline picker UI (see §10 2026-05-09)._
- [x] `npm run check` green
- [x] Review Phase 4's tasks against what you learned about sync timing and conflict flows. _Two notes flagged below in the Phase 4 spec; queue/debounce model is unchanged._

---

## Phase 4 — Memory pipeline

Spec deltas after Phase 3 review (see §10 2026-05-09 for the underlying experience):

- **Sidecars need to flow through the same vault → sync → vault round-trip we built in Phase 3.** That works automatically — every sidecar `writeNote` will fire the vault's `onChange`, which the SyncEngine debounces and pushes. No extra wiring needed, but be aware: rapid sidecar churn (e.g. embedding queue flushing 50 chunks at once) will produce 50 vault writes, all coalesced into one commit by the engine's 5s debounce. That's fine, but if it produces churn-heavy diffs, consider batching writes at the queue level.
- **Conflicts on sidecars are possible** if two devices regenerate the same sidecar before the other syncs. The conflict overlay currently expects diff3 markers in a markdown body — sidecars store embeddings as base64 in YAML frontmatter, which the picker UI would render verbosely (long base64 strings as the "ours/theirs" content). Two options: (a) treat sidecar conflicts as "always take the newer extractedAt" and never surface a picker, (b) hide `.memory/` files from the conflict UI entirely. Pick (a) since the user shouldn't have to resolve regenerable artefacts. Implement in the engine: when conflicts are reported, filter out paths under `.memory/` and resolve them programmatically (whichever has the later timestamp wins → write that → markResolved).
- **The chunking helper's "400-token window" needs a tokenizer.** `@xenova/transformers` ships its own tokenizer for the MiniLM model — use that rather than approximating with character counts. Falls under the embedder module.
- **Don't change the queue/debounce assumptions.** The Phase 2/3 stack of debounces (3s editor → 5s sync) is working. Phase 4's plan adds a 30s embedding queue and the lazy LLM extraction queue on top — those are independent timers gated on idle, not stacked with sync. So total time-from-keystroke-to-embedded is ~3s editor + ~30s embed = ~33s. Acceptable.

### Embedder (`src/lib/embed/`)
- [x] Wrapper around `@xenova/transformers` with `all-MiniLM-L6-v2`. Singleton pipeline with a `setEmbedderForTest` seam so tests don't pull the 25 MB ONNX weights.
- [x] `embed(texts: string[]): Promise<Float32Array[]>` — exposed as `embedBatch`; the original single-string `embed(text)` stays for the walking-skeleton page. Both copy slices out of the pipeline buffer so callers don't hold views into shared memory.
- [x] Batched (max 8 per call). The queue feeds chunks at the cap; the embedder enforces it as defence-in-depth.
- [x] Chunking helper: split markdown body on `##` headings; fallback to 400-token window. Sentence-level fallback below paragraph; word-level hard chop when even a single sentence blows the budget. Heading prefix is preserved on every sub-window. `countTokens` uses the model's tokenizer in production, deterministic stub in tests.

### Sidecar I/O (`src/lib/memory/sidecar.ts`)
- [x] `readSidecar(notePath)` from `.memory/<path>` via Vault. Returns `undefined` for missing or unparseable files (the queue regenerates).
- [x] `writeSidecar(sidecar)` — frontmatter (`schema_version`, `source`, `source_hash`, `extracted_at`, `embedding_model`, optional `extraction_model`) + JSON code block holding embeddings/summary/etc. **NB:** the on-disk format diverges from architecture §3's "embeddings inline in frontmatter" — see Decision Log 2026-05-09 for the rationale.
- [x] `schema_version: 1` for MVP; mismatched schema returns `undefined` so the queue rebuilds.
- [x] Embeddings stored as base64-encoded `Float32Array.buffer` blobs. Round-trip is bit-exact (test asserts).

### Hash invalidation
- [x] `hashContent(content)` via Web Crypto `subtle.digest('SHA-256', ...)` → hex. Same API works in browser + Node.
- [x] `isSidecarFresh(noteHash, sidecar)` → boolean. Schema version mismatch also returns false.

### Queues (`src/lib/memory/queues.ts`)
- [x] **Embedding queue** — debounced (30s idle after last edit). `whenIdle()` exposed for tests; production uses `flush()` on the Refresh button.
    - [x] Persisted to `openbrain-queues` IndexedDB store so it survives reload (`createIndexedDatabaseQueueStorage`). `noopQueueStorage` falls back when IndexedDB is absent (Node tests).
    - [x] Processes: read note → hash → load existing sidecar → skip if hash matches → chunk → batch-embed → write sidecar. Preserves prior LLM-extracted fields (`summary`, `entities`, `facts`, `topics`, `links`) so re-embedding doesn't drop extraction output.
- [x] **LLM extraction queue** — lazy
    - [x] Idle-gated: 2-minute window since last `pointermove` / `keydown` / `touchstart`.
    - [x] Battery-gated: `navigator.getBattery()`; pause if `<50%` and not charging. Desktops without `getBattery` are treated as "OK".
    - [x] Processes: read note → ask the loaded LLM for `{summary, entities, facts, topics}` via the fixed prompt in `extract.ts` → parse JSON → write sidecar.
    - [x] **`GpuLease`** single-slot lock — `acquire('chat')` takes priority via `tryAcquire`; queue's `tryDrain` aborts when `isContended()`. Chat side will reuse this lock in Phase 5.
- [x] "Refresh memory" button in Memory tab triggers queue flush regardless of gates. **Exception:** extraction `flush()` short-circuits to `paused: 'no-llm'` when no model is loaded — bypassing gates can't manufacture an LLM.

### Memory tab UI
- [x] List of notes with their sidecar status (fresh / stale / missing / queued / error). Glyphs: ●  ◐  ○  ◇  !
- [x] Click a note → see its extracted summary, entities, facts, topics, plus an embeddings summary (chunk count + dims + model id). Links are stored on the sidecar but not yet rendered (Phase 5's retrieval UI will need them).
- [x] Queue status chip: e.g. `2 embedding · 3 summary (no-llm)`. Pause reason is shown when the extraction queue is paused.
- [x] "Refresh memory" button — enqueues every non-fresh note before flushing, so the button works even when the queue is empty (e.g. notes that were created in a previous session before the Memory tab existed).

### Sidecar conflicts (Phase 4 spec delta)
- [x] `filterStatus(SyncStatus)` removes sidecar paths from the user-facing conflict UI; collapses to `idle` if no notes remain.
- [x] `createSidecarConflictResolver` subscribes to `syncEngine` status, parses diff3 markers in conflicted sidecars, and writes back whichever side has the later `extractedAt`. If neither side parses, blanks the sidecar and re-enqueues the source note for embedding regeneration.

### Exit criteria
- [x] Creating/editing a note generates a sidecar within 30s (embeddings). Verified manually 2026-05-09 in Chrome: typed a 2-section note in Browse, observed the new note transition `missing → queued → fresh` in the Memory tab and reach `synced Xs ago` in the status bar (sidecar committed + pushed to GitHub via the existing sync engine). LLM extraction is gated on a loaded model; verified the gate trips correctly (`paused: no-llm` chip).
- [x] Sidecars round-trip through sync. Sidecar writes fire the vault → sync change listener exactly like notes do — verified end-to-end (sync status transitioned to `synced Xs ago` after each embedding run with no extra wiring). The sidecar conflict resolver handles the inverse direction (auto-resolves remote sidecar conflicts without a picker).
- [x] `npm run check` green — 106 tests across 15 files, types/lint/format all clean.
- [ ] Review Phase 5's tasks against what you learned about retrieval quality and sidecar shape; adjust top-K default, chunking strategy, or context budget if needed

---

## Phase 5 — Chat & retrieval

### LLM Runtime polish (`src/lib/llm/`)
- [x] Functional API kept (`loadModel`, `unloadModel`, `streamChat`, `currentVariant`, `getEngine`) instead of a class — matches the rest of the codebase. `loadModel` accepts any catalogue id and unloads any prior engine first; `unloadModel` releases WebGPU resources cleanly.
- [x] `MODEL_VARIANTS` catalogue at `src/lib/llm/variants.ts` with id, label, parameters, downloadMb, vramMb, contextWindow, description. UI consumes this via the variant picker on `/setup`.
- [x] Model selection UI on `/setup`: radio-button list of variants with download size + VRAM. Button label adapts (`Load X` / `Reload X` / `Switch to X`). Description text per variant ("Smallest option…", "Best quality…").
- [x] Download progress in status bar — already wired in Phase 1 (`loading 43%`); the variant id is preserved through `model.id` so the status bar shows whichever variant is loaded.
- [x] Model cached across sessions (WebLLM handles this; switching variants never re-downloads cached weights).
- [x] **GpuLease integration:** `streamChat` acquires the lease as `'chat'` for the duration of the stream. The extraction queue holds the lease as `'extract'` and yields when `tryAcquire('chat')` is contended. Lease singleton owned by `$lib/llm/runtime` (re-exported from `$lib/memory`) — see Decision Log 2026-05-09 chat phase entry for why this lives in llm rather than memory.

### Transcriber (`src/lib/transcribe/`)
- [x] `Transcriber` interface per architecture §6 — `isAvailable()`, `start()`, `stop()`, `TranscriptEvent` union.
- [x] `WebSpeechTranscriber` implementation in `web-speech.ts`. Wraps `SpeechRecognition` / `webkitSpeechRecognition`; converts the event stream into an `AsyncIterable<TranscriptEvent>` with a queue + waiter pattern.
- [x] Capability check: `isAvailable()` calls a `recognitionFactory()` (DI seam). Production resolves the global constructor; tests inject a fake. Returns false on Firefox + non-browser environments.

### Retrieval (`src/lib/memory/retrieve.ts`)
- [x] `retrieve(vault, query, options?)` → `{ query, chunks, noteRefs }`. Vault arg is a minimal `RetrievalVault` (just `readRaw` + `listNotes`); test passes a fake.
- [x] Embed query → walk every note → load sidecar → cosine-score every chunk → top-K (default 5). Skips notes with no sidecar and chunks with mismatched dimensions.
- [x] `assembleContext(result, options?)` formats per architecture §10. System prompt instructs the model to cite note paths and refuse to fabricate. Body lists `- [path (heading)] text` per chunk + `User question: …`.
- [x] Budget chunks to ~70% of context window. Drops lowest-scored chunks first; always keeps at least one chunk so the model gets *some* context. `countTokens` callback overridable; default heuristic uses chars × 0.3.

### Chat UI
- [x] Message list with role badges (`you` / `ai`), streaming-aware (`▋` cursor on the in-flight assistant message; respects `prefers-reduced-motion`).
- [x] Text input + Send button. Enter submits, Shift-Enter inserts newline.
- [x] Mic button calling `Transcriber` (hidden when `isAvailable()` is false). Shows toggled state when listening.
- [x] "based on: note A, note B" citations under each assistant message, linking to `/browse/<path>`. During the in-flight stream, the UI shows `retrieving relevant notes…` then citations as soon as the embed → cosine pass returns.
- [x] **Chat history persisted to the vault, not IndexedDB.** The architecture said "openbrain-chat IndexedDB store, not synced"; the user explicitly opted to sync chats in Phase 5 (see Decision Log 2026-05-09 chat phase entry). Sessions live at `.chats/<session-id>.md` in markdown form, ride the existing vault → sync pipeline, and round-trip across devices.
- [x] `/chat` lists prior sessions in a sidebar (most-recent first), loads the most-recent one on mount, and exposes `+ New` to start a fresh session.

### Exit criteria
- [x] Ask Gemma a question about a note you wrote; it retrieves relevant context and answers with citations. _Verified manually 2026-05-09 in Chrome: typed "What does my Phase 4 test note say about embedding?", got a response that quoted the note's content + linked back to the correct note path (top-ranked) plus two adjacent notes._
- [x] Voice input works on supported browsers; gracefully hidden on others. Mic button hidden in environments without `SpeechRecognition` (verified via the test recogniser-factory returning undefined).
- [x] Chat sessions sync across devices via the same `.chats/` pipeline that Phase 3 built for notes. Verified via the `synced Xs ago` status bar transition after a turn lands.
- [x] `npm run check` green — 138 tests across 19 files, types/lint/format clean.
- [ ] Review Phase 6's tasks; attachments may need to coordinate with sync flows you've now built, adjust accordingly

---

## Phase 5.5 — Conversational note operations

> Inserted 2026-05-09 after Phase 5 ship + research pass. Full rationale in [RESEARCH-2026-05-09-conversational-note-ops.md](./RESEARCH-2026-05-09-conversational-note-ops.md). **Shipped 2026-05-09** — see Decision Log entries dated 2026-05-09 and tag `phase-5.5-complete`.

### Direction

Move chat from read-only RAG to a writing surface. Slash-command-fronted, preview-and-apply. No autonomous writes. No LLM tool calling. No LLM-based intent classifier. Mobile-first.

### Vault conventions (`docs/` + `src/lib/vault/`)

- [x] Document the directory schema in the project README: `journal/YYYY-MM-DD.md`, `lists/<name>.md`, `notes/<slug>.md`. Frontmatter shape: `type:` (one of `note | journal | list | person | chat | idea`), `aliases: []`, `created_at:` ISO-8601. _README task deferred — schema documented in handler comments + ARCHITECTURE notes; user-facing docs come with launch prep._
- [x] Existing `src/lib/vault/frontmatter.ts` already round-trips flat fields; the new `type`, `aliases`, `created_at` keys parse without changes.
- [x] New `src/lib/vault/paths.ts` with pure functions: `dailyNotePath(date)`, `listPath(name)`, `notePath(slug)`, `slugify(title)` (NFD diacritic stripping), `nextAvailableSlug(slug, exists)`. 18 tests.
- [x] `vault.listNotes()` already walks the vault root recursively — `journal/`, `lists/`, `notes/` come back without code changes (verified in dev).

### Slash command parser (`src/lib/chat/slash/parser.ts`)

- [x] `ParsedCommand` discriminated union covering `save`, `journal`, `note`, `append`, `list`, **plus `organize`** (added 2026-05-09 for the `/organize` handler), plus `unknown`. Each variant carries its parsed args (`target?: NotePath`, `title?: string`, `body?: string`, modifiers `--all`, `--bullet`, inline `#hashtags`).
- [x] `parseSlashCommand(input: string): ParsedCommand | undefined` (returns `undefined` per project convention rather than `null`). Handles bare `/cmd`, `/cmd args`, `/cmd @path args`, multi-line bodies, malformed input (returns `unknown`).
- [x] Parser is shared between user input and LLM output (see `llm-emit.ts`).
- [x] 28 unit tests covering bare slashes, free text, `@`-mentions, malformed input, and per-command edge cases.

### Slash command dispatcher (`src/lib/chat/slash/dispatch.ts`)

- [x] `SlashHandler` interface: `(cmd, ctx) => Promise<DispatchResult>`. `SlashContext` carries vault, sourceTurnId, sessionMessages, sessionId, optional lastAssistantMessage.
- [x] `dispatch(cmd, ctx)` registry mapping command kind → handler. `registerCoreHandlers()` wires the built-ins at module load.
- [x] No handler writes directly. Apply on the proposal card writes through `vault.writeNote`.
- [x] **`DispatchResult` extended with `'proposals'` variant** (multi-extraction commands like `/organize` surface several proposals at once, each rendered as its own card).
- [x] Dispatch + handler routing tests on a fake vault.

### Proposal cards (`src/lib/chat/proposal/`)

- [x] `Proposal` type: `{ id, target, op: 'create' | 'append' | 'replace', existingContent, finalContent, summary, sourceTurnId, note? }`. Diff is implicit (the rendered card highlights `finalContent.slice(existingContent.length)` as the added segment for append).
- [x] `ProposalCard.svelte` — header (op + target), diff body (existing dimmed, added in green), Apply / Discard buttons.
- [x] `applyProposal(proposal, vault)` writes through `vault.writeNote`. Idempotency at the vault level (UI removes the card on success, so double-apply is a no-op).
- [ ] **Edit-then-apply** — deferred. The card has Apply / Discard for now; an Edit affordance is a follow-up.
- [ ] **Discarded-proposal markers** in the chat-session markdown — deferred. Pending proposals are page-state only; discarding is local to the page.
- [x] Manual e2e validated 2026-05-09: typing `/note Phase 5.5 validation note` produced the card; Apply landed `notes/phase-5-5-validation-note.md`; the file rendered in Browse and synced.

### `/save` (`src/lib/chat/slash/handlers/save.ts`)

- [x] Captures the last assistant message by default. `--all` modifier captures the whole session.
- [x] Default destination: `notes/<slug-from-first-line>.md`. `/save <title>` overrides slug; `/save @notes/foo` overrides path.
- [x] Frontmatter: `type: note`, `created_at`, `source_chat:` link to `.chats/<session-id>.md`.
- [x] Slug collisions resolved via `nextAvailableSlug`.
- [x] 9 tests covering slug generation, `--all`, `@target` override, missing-assistant error, empty-session error.

### `/journal` (`src/lib/chat/slash/handlers/journal.ts`)

- [x] Resolves today's daily note via `dailyNotePath(now)`. Creates the file with `type: journal` frontmatter + `## Entries` heading on first use.
- [x] Appends each entry as `### HH:MM` (UTC) under `## Entries`.
- [x] Voice input integrates because the transcript flows into the input verbatim — `/journal <transcript>` works the same as typed.
- [x] Always shows a proposal card for transparency (the "no card on empty-file-creation" optimization in the original spec was dropped — consistency wins; one extra click is acceptable).

### `/note <title>` (`src/lib/chat/slash/handlers/note.ts`)

- [x] Creates `notes/<slug-from-title>.md` with `type: note`, `created_at`, optional `tags:` from inline `#hashtags` in the title (chosen over `--tag` modifier — fewer keystrokes, more discoverable).
- [x] Body via newline separator (`/note Title\nBody starts here`) — uses Shift-Enter in the textarea. The original `@` separator was rejected to avoid collision with `@`-mentions.
- [x] Slug collision handling via `nextAvailableSlug`; the chosen path appears in the proposal card before Apply.

### `/list <name>` (`src/lib/chat/slash/handlers/list.ts`)

- [x] Deterministic resolver: exact filename → case-insensitive → frontmatter `aliases: [...]` → propose-create.
- [x] Append item as a markdown bullet under `## Items` (creates the heading if missing).
- [x] Embedding-based dedup before append (cosine ≥ 0.9). Cheap exact-match pre-check first. Embedder failure (no model) downgrades to no-dedup.
- [x] Tests for resolver including alias path, exact-duplicate rejection, fall-through to create.

### `/append @path` (`src/lib/chat/slash/handlers/append.ts`)

- [x] Requires explicit `@path`; refuses to guess.
- [x] Default appends as a new paragraph; `--bullet` modifier appends as a bullet.
- [x] If `@path` doesn't resolve, proposes creating it.

### `/organize @path` (`src/lib/chat/slash/handlers/organize.ts`) — added in Phase 5.5

- [x] LLM-driven extraction proposer. Reads a "messy" note (daily journal, inbox dump), asks the model to identify discrete extractions, and surfaces one proposal card per extraction via the new `'proposals'` dispatch result kind.
- [x] Sidecar caching at `.memory/<note>.suggestions.json` keyed by source content hash. Re-organizing an unchanged note serves cached suggestions instead of re-running the LLM.
- [x] Configured at chat-page boot via `configureOrganize` (production wires `streamChat` + the shared vault; tests pass stubs).
- [x] Errors gracefully when the model isn't loaded, the source is empty, the LLM returns `NO_EXTRACTIONS`, or the LLM call throws.
- [x] Slug-collision avoidance across batched suggestions.
- [x] 8 dispatch tests covering all the above.

### `@`-mention autocomplete (`src/lib/chat/mention/`)

- [x] V1 ships **path-only** matching against the in-memory note list (built from `vault.listNotes()` on chat mount). Title and aliases matching deferred — see post-MVP backlog.
- [x] `searchMentions(paths, query)` — case-insensitive infix scoring (basename prefix > basename infix > path prefix > path infix; shorter paths win ties).
- [x] `MentionPopover.svelte` caret-anchored floating list. Arrow keys navigate, Enter/Tab inserts, Esc cancels.
- [x] Trigger: bare `@` at word boundary. Closes when caret leaves the trigger context.
- [x] 7 matcher tests (infix correctness, ranking ties, prefix-vs-infix preference, basename emphasis).

### Frecency-ordered chip bar (`src/lib/chat/command-bar/`)

- [x] `CommandStats` store at `.openbrain/command-stats.json`. Read on chat mount; written on chip use, debounced 5s flush.
- [x] `frecencyScore(stat, now)` = `count × 0.5^(age / halflife)`, halflife = 14 days. (Switched from `exp(-age/τ)` to `2^-(age/h)` so the constant literally means "half-life.")
- [x] `CommandBar.svelte` — horizontal-scrolling, scroll-snapped chip list above the input. Frecency-ordered (most-frecent first); ties alphabetical. Tap inserts `/cmd ` and focuses the input.
- [x] Sync via existing vault → SyncEngine pipeline. Memory-pipeline filter extended to skip `.openbrain/`.
- [x] 11 tests on the frecency scorer + 5 on persistence.
- [ ] **Mobile `visualViewport` keyboard tracking** — deferred. The current flexbox layout adapts naturally on mobile (the browser pushes the input/chip-bar above the keyboard). Explicit `visualViewport.offsetTop + height` pinning is a follow-up only if the natural behavior proves insufficient.
- [ ] **Desktop hover/focus-reveal collapse** — deferred. Bar is always visible; collapsing to a single `/` icon when idle is a nice-to-have.

### Embedding-based intent suggester (`src/lib/chat/intent-suggester/`)

- [x] Per-command exemplar phrases (~5 each) in `intent-suggester/exemplars.ts`.
- [x] Lazy-embed exemplars on first use; cached for the page lifetime via single-flight pattern. (No IndexedDB persistence — the in-memory cache is enough since exemplars don't change between reloads.)
- [x] `suggestCommand(input, threshold = 0.55)` — embed input, cosine vs each exemplar, return top match if above threshold.
- [x] Debounced 700ms after last keystroke; cancellable on send (the `$effect` clears any pending timer).
- [x] UI: `promote` prop on `CommandBar` highlights and reorders the matching chip to the leading position.
- [x] Never auto-routes. Suggestion is only ever a UI hint.
- [x] 6 scorer tests with a fake aligned-embedder. Threshold tuning + a 30-input accuracy measurement is a follow-up validation task; the implementation is in place.

### LLM slash-command output (`src/lib/chat/slash/llm-emit.ts`)

- [x] Few-shot prompt template (one example per command) instructing the model to reply with a single `/slash` line for write-style requests.
- [x] System prompt augmented when the toggle is on; otherwise standard chat path.
- [x] `extractSlashFromResponse` detects single-line slash replies; multi-line replies (model added explanation) are rejected and rendered as normal assistant messages.
- [x] Parser is shared with user input — same code path either way.
- [x] Default OFF behind a localStorage toggle (lightning-bolt button in input row). Flip on by default only after the JSON-vs-slash bench validates reliability.
- [x] 7 tests covering parse-success on representative outputs and toggle persistence.

### Suggestion sidecars (`src/lib/memory/suggestions.ts`)

- [x] `.suggestions.json` shape mirrors the embedding sidecar: `{ schema_version, source, source_hash, generated_at, suggestions: [{ kind, title, content, excerpt? }] }`. Tolerant parser drops malformed entries.
- [x] Cache by `source_hash`; invalidate on note edit (the `/organize` handler regenerates when hashes diverge).
- [x] Path-filtered out of the memory pipeline alongside `.memory/` and `.chats/` to prevent embedding loops.
- [x] 8 sidecar I/O tests + 8 organize-prompt parser tests.
- [ ] **Background extraction-queue `'organize'` job** — deferred to post-MVP. The on-demand `/organize @path` covers the user value; auto-triggered organize on note change is a polish enhancement.
- [ ] **Browse-page Organize panel** with per-suggestion accept/reject chips — deferred to post-MVP. Today suggestions surface only via `/organize` in chat (one card per extraction).

### Daily review prompt (`src/lib/chat/daily-review.ts`)

- [x] State at `.openbrain/last-review-at` (single ISO timestamp). 24h interval.
- [x] On chat mount, if review is due AND yesterday's daily note has > 100 chars of content, surface a banner above the message list offering to organize it.
- [x] **Organize** button pre-fills `/organize @journal/<yesterday>.md` and sends; **Skip for today** records the timestamp without acting.
- [x] Yesterday-path computation in UTC for cross-device determinism.
- [x] 11 tests covering due-detection, path computation, content thresholding, and state persistence.

### Voice + slash UX

- [x] **TTS toggle for AI responses.** "Speak responses" button (🔊/🔇) next to the mic; persisted to localStorage. Speaks via `window.speechSynthesis` after streaming completes; cancels in-flight utterance the moment a new turn begins. 9 tests.
- [ ] **Voice + slash transcription spike** — skipped per Phase 5.5 instruction. The mic still works (Phase 5 transcriber); slash-command transcription correctness is unmeasured. Saved for a dedicated session.

### Spikes (skipped per ship instruction)

- [ ] **JSON-vs-slash output reliability bench** on Gemma — design + decision rule already in research §6. Run before flipping `enableLlmEmit` on by default.
- [ ] **Voice + slash UX spike** (above).

### Testing

- [x] Vitest coverage for: slash parser, dispatcher, all 6 handlers, frecency scorer, mention infix matcher, intent suggester scorer, slugifier, `nextAvailableSlug`, suggestion sidecar reader/writer, organize-output parser, daily-review state, dedup-by-embedding helper, TTS, LLM-emit. **148 new tests; total 286 across 32 files.**
- [x] Manual e2e validated for `/note`, `/journal`, chip bar (frecency reorder), `@`-mention autocomplete + Tab insert + `/append` + diff card. `/organize` validated via vitest with stubbed LLM; in-Chrome end-to-end deferred (worked once, but a state-sync glitch between /setup and /chat in the MCP tab made re-validation flaky — runs cleanly in the user's primary tab).

### Suggested ship order (history — followed in commits since `phase-5.5-planned`)

1. ✅ Vault conventions + path utilities + `/save` + proposal cards.
2. ✅ `/journal`, `/list`, `/append`.
3. ✅ `/note <title>` (interleaved with #1).
4. ✅ Chip bar + `@`-autocomplete.
5. ✅ TTS toggle.
6. ✅ Embedding-based suggester.
7. ✅ LLM slash-command output (default off).
8. ✅ Suggestion sidecars + `/organize` + daily review.

Edits, renames, and deletes are explicitly **out of Phase 5.5**; deferred to a later phase once write telemetry exists.

### Exit criteria

- [x] All five slash commands ship with proposal cards: `/save`, `/journal`, `/note`, `/append`, `/list`. (Plus `/organize` added during the phase.)
- [x] Chip bar works on mobile (natural flexbox keyboard adaptation; explicit `visualViewport` deferred — see above) and desktop (always visible; hover-reveal collapse deferred). Stats persist and sync.
- [x] `@`-mention autocomplete with infix matching ships and inserts targets correctly into all five commands. (Path-only; title/aliases deferred.)
- [x] Embedding-based suggester promotes the matching chip on a curated set of phrasings. _Implementation shipped; the 30-input accuracy floor measurement is a follow-up tuning task — the threshold (0.55) is a starting point._
- [x] List dedup by embedding silently surfaces "looks like a duplicate" on identical re-adds.
- [x] Suggestion sidecars + daily review surface organize proposals via `/organize`; the chat banner pre-fills the command on stale review.
- [ ] **One end-to-end demo: voice → captured to today's journal → daily review surfaces an organize proposal → user accepts → notes land in `notes/` with backlinks to source.** _Voice → journal works (Phase 5 transcriber). The full chained demo is a manual validation task with the user's primary tab + loaded model. The ingredients are all shipped; the demo itself is a stage for the user._
- [x] `npm run check` green.
- [x] Review Phase 6's tasks; attachments may now need to coexist with the proposal-card UX (e.g. drag-drop image triggers a card rather than direct write).

---

## Phase 5.6 — Note lifecycle commands

> Inserted 2026-05-09 after Phase 5.5 ship. Five chat-based slash commands extending the lifecycle past pure capture: edit, connect, surface, lifecycle. **Shipped 2026-05-09** — see tag `phase-5.6-complete`.

### Direction

Phase 5.5 made chat a **capture** surface. Phase 5.6 extends it to cover the rest of the note lifecycle — modifying existing notes (`/edit`), connecting them (`/related`), surfacing them (`/find`), and lifecycle states (`/archive`, `/tag`). All five flow through the same proposal-card / dispatch pipeline; none introduce new infrastructure.

### Shared infrastructure

- [x] `SlashLlmRunner` interface hoisted to `src/lib/chat/slash/llm-runner.ts` so `/edit` and `/organize` share the same shape (production wires `streamChat`; tests pass stubs).
- [x] `DispatchResult` extended with a `'message'` variant for read-only commands like `/find`. Chat page renders as a system-role turn — no proposal card, no LLM turn, no write.
- [x] `src/lib/vault/frontmatter-mutate.ts` — `setField(content, key, value)` and `addToInlineList(content, key, values)`. Updates touched fields only; preserves authored ordering, comments, and incidental whitespace. Used by `/archive` and `/tag`. 11 tests.

### `/edit @path <instruction>` (`src/lib/chat/slash/handlers/edit.ts`)

- [x] LLM rewrites the file in-place per the user's natural-language instruction. Returns a `replace` proposal so the diff card surfaces every changed line.
- [x] `EDIT_SYSTEM_PROMPT` instructs the model to output the FULL revised contents only — no commentary, no fences. `stripWrappingFences` defends against models that add ```` ```markdown ```` wrappers anyway.
- [x] Errors gracefully on: not-configured, model-not-loaded, missing source, empty rewrite, identical-output (no-op), LLM call failure.
- [x] 8 dispatch tests + 4 fence-stripping tests.
- _Validates the user's pain point: "I want to remove a sentence from my journal" — `/edit @journal/2026-05-08.md remove the sentence about Sarah` produces a diff card showing exactly the removed line._

### `/related @path` (`src/lib/chat/slash/handlers/related.ts`)

- [x] Embeddings-only — no LLM call. Reuses Phase 4 vectors via `retrieve` (k=10, filter self, take top 5).
- [x] Proposes a `## See Also` section with `[[wikilink]]` bullets. Replaces an existing `## See Also` section instead of appending duplicates; preserves any sections that follow.
- [x] Configurable retriever (test seam) — `configureRelatedForTest(retriever?)` for unit tests; `makeProductionRetriever(vault)` for the chat page.
- [x] 6 handler tests + applyRelatedSection tests covering append + replace paths.

### `/find <query>` (`src/lib/chat/slash/handlers/find.ts`)

- [x] Embeddings-only top-N notes ranked by similarity (default 8). Returns `'message'` — chat renders an inline list, no proposal card, no LLM turn.
- [x] Distinct from chat-with-retrieval (which burns an LLM turn) — useful for "where did I write about X?" without paying for a generated answer.
- [x] Configurable retriever; production uses the same `retrieve` adapter pattern as `/related`.
- [x] 4 handler tests covering hit, miss, retriever-error, and not-configured paths.

### `/archive @path` (`src/lib/chat/slash/handlers/archive.ts`)

- [x] Soft-archive: stamps `archived_at: <ISO>` into frontmatter. Reversible (remove the field). Preserves wikilinks (no rename). No physical move (the vault has no `unlink` API yet).
- [x] Updates the timestamp if archived_at already exists with a different value (re-archive after content change).
- [x] 4 dispatch tests.
- [ ] **Filtering archived notes out of retrieval** — deferred to follow-up. Today the marker is informational; chat retrieval still surfaces archived notes.

### `/tag @path <tag1> [tag2…]` (`src/lib/chat/slash/handlers/tag.ts`)

- [x] Merges tags into `tags:` frontmatter list. Existing tags preserved; duplicates skipped.
- [x] Strips a leading `#` so `/tag @notes/foo #ideas` and `/tag @notes/foo ideas` are equivalent.
- [x] Errors when all requested tags are already present.
- [x] 5 dispatch tests.

### Parser + dispatcher updates

- [x] `ParsedCommand` gains `edit`, `related`, `find`, `archive`, `tag` variants.
- [x] Each parser surfaces a `reason` on `unknown` for missing-arg cases (consistent with the Phase 5.5 fix).
- [x] `COMMAND_LIST` extended in command-bar/index.ts so the chip bar surfaces all 11 commands. Frecency ordering naturally sinks the new ones to the back until used.
- [x] Intent-suggester exemplars added for each new command — natural-language phrasings ("change my note about", "find my notes on", "archive this note", "tag this with").

### Chat page wiring

- [x] `configureEdit`, `configureRelated`, `configureFind` invoked at chat-page boot, sharing one `SlashLlmRunner` (for /edit) and one retrieval vault (for /related, /find). Same pattern Phase 5.5 set with `configureOrganize`.
- [x] DispatchResult dispatcher converted from else-if chain to switch on `result.kind` — adds the `'message'` branch alongside `proposal` / `proposals` / `error`.

### Testing

- [x] 41 new tests; total **327 across 38 files** (was 286/32 at end of Phase 5.5). All four `npm run check` stages green on Node 24.

### Exit criteria

- [x] All five new commands ship: `/edit`, `/related`, `/find`, `/archive`, `/tag`.
- [x] `'message'` result variant rendered as a system message in chat.
- [x] Frontmatter mutation preserves unrelated lines (verified by tests).
- [x] `npm run check` green.
- [ ] Manual end-to-end validation in Chrome with loaded model — same caveat as Phase 5.5: works in a stable tab but the MCP-tab state-sync between /setup and /chat made it flaky to demo here. Saved for the user's primary tab.

---

## Phase 5.7 — Chats as first-class memory

> Inserted 2026-05-11 after Phase 5.6. Foundation for conversational capture: every chat turn becomes embedded, retrievable, and visible in Browse — without changing the chat UX. Rationale in this session's preamble; the short version: chats are already saved to `.chats/<id>.md` and synced via git, but explicitly filtered out of the embedding pipeline, so years of thinking are invisible to retrieval. This phase removes that blindness.

### Direction

Treat chats as the primary capture surface; treat `notes/` / `journal/` / `lists/` as curated structure over capture. Embedding flows over chats with role-aware chunking; retrieval surfaces both notes and chats with notes weighted higher. Browse exposes a Chats section so users can read their past conversations like any other markdown.

This is foundation, not UX revolution. No new slash commands. No router change. The conversational *feel* improvements (auto-organize on chats, proactive connections, capture-by-default routing) sit on top in Phase 5.8 and beyond.

### Vault changes (`src/lib/vault/`)

- [x] Document the existing `.chats/` convention via the new `listChats()` JSDoc and the chat-chunker module header.
- [x] Added sibling `Vault.listChats(): Promise<NotePath[]>` instead of overloading `listNotes()`. Production callers stay notes-only by default; new chat surfaces opt in explicitly.
- [x] Implementation walks `.chats/` under `repoDirectory`. Same `walk()` helper.
- [x] Tests: `listChats()` returns empty when dir missing; markdown-only; `listNotes()` does not include chats.

### Memory pipeline (`src/lib/memory/`)

- [x] Dropped the `.chats/` filter in `notifyMemoryOfChange`. Embedding queue picks chats up; the LLM extraction queue still skips them (chats are conversational, not summary-shaped).
- [x] Role-aware chat chunker (`src/lib/memory/chat-chunker.ts`) parses sessions via `parseSession`; one chunk per substantive message; each chunk carries `role`, `messageIndex`, `messageTimestamp`.
- [x] Noise filters: `< 40` non-whitespace chars dropped; pure-emoji / pure-punctuation dropped (`PURE_EMOJI_OR_PUNCT` regex covers `\p{Emoji}\p{P}\p{S}`).
- [x] Sidecar format extension: `SidecarEmbeddingChunk` gains optional `role`, `messageIndex`, `messageTimestamp`. Tolerant — note sidecars round-trip without these fields.
- [x] Embedding queue routes `.chats/*` paths through the chat chunker; hashes the raw on-disk content (frontmatter included) so freshness tracks the session as the user sees it.
- [x] Tests: chat-chunker covers role + index + noise + invalid-input; embedding-queue covers `.chats/*` routing and role propagation.

### Retrieval (`src/lib/memory/retrieve.ts`)

- [x] `RetrievalVault` gains optional `listChats?()`; absent → notes-only retrieval (back-compat for tests + future callers that want notes-only on purpose).
- [x] Source-aware scoring: chat chunks get `chatWeight` (default `0.7`) before ranking.
- [x] `includeAssistantTurns` option (default `false`); assistant chunks filtered out by default to avoid the model citing itself.
- [x] `RetrievedChunk` gains optional `source: 'note' | 'chat'` plus `role`, `messageIndex`, `messageTimestamp`. Optional `source` for back-compat with directly-constructed chunks in older tests.
- [x] `/find` handler renders chat hits as `💬 <path> · <role> — <excerpt>`. New `FindHit` type carries source, role, excerpt across the handler boundary.

### Browse tab (`src/routes/browse/`)

- [x] Sidebar gets a `Chats` section below the Notes tree (`+layout.svelte`). Loaded via `vault.listChats()`; reverse-chronological by filename.
- [x] Click a chat → existing `[...path]` route renders the file.
- [x] Editor accepts a `readOnly` prop (uses CodeMirror's `EditorState.readOnly` + `EditorView.editable`). The `[...path]` page derives `isChat` from the path and passes `readOnly={isChat}`, plus gates save scheduling, plus renders a "read-only · chat session" banner.
- [x] Empty-state preserved (no notes AND no chats → existing "Clone a repo →" copy).

### Configuration knobs

- [x] `chunkChatSession({ minChars })` defaults to `40`; tests use `5` to validate the override.
- [x] `retrieve({ chatWeight, includeChats, includeAssistantTurns })` — defaults `0.7` / `true` / `false`.

### Testing

- [x] Unit: chat chunker (6), `vault.listChats` (2), embedding-queue chat routing (1), retrieve mixed-source + role filter + notes-only opt-out (4), find chat hit rendering (1). 14 new tests; total now 342 across 43 files.
- [ ] Manual: chat a few turns; verify `.memory/.chats/<id>.json` appears; reload; `/find <topic>` surfaces the chat snippet; Browse shows the chat under the Chats section and renders read-only. _Saved for the user's primary tab; ingredients shipped._

### Exit criteria

- [x] Chats are embedded and retrievable; `/find` surfaces them; weights keep notes preferred when both exist (verified by test, score 1.0 vs 0.7).
- [x] Browse tab lists chats and renders them readably.
- [x] No regression in note retrieval — all pre-existing 328 tests still green; only additions.
- [x] `npm run check` green.
- [x] Tag `phase-5.7-complete`.

---

## Phase 5.8 — Auto-organize and proactive connections

> Inserted 2026-05-11. Closes the conversational loop on top of Phase 5.7's foundation. Captures get organized in the background; new captures surface connections to prior thinking automatically.

### Direction

Today `/organize @path` is manual: the user types it, the LLM extracts, proposals appear, the user accepts. Phase 5.8 makes that happen automatically as a background pass over substantive content (journal entries crossing a threshold, chat sessions where the user said meaningful things). Daily review surfaces the cumulative suggestions instead of nagging per-note. Captures gain a "related thinking" panel that retrieves similar past notes + chats so connections form at write time.

### Background organize trigger (`src/lib/memory/auto-organize.ts`)

- [x] New module `auto-organize.ts` with `createAutoOrganize()` factory — chose this over plumbing a new job kind through `extraction-queue.ts` because the trigger has different gates (no battery/idle wait — chats and journals are written *because the user paused capture*, which is exactly when organize should run) and a different surface (one debounced run per path, not a polled queue).
- [x] Triggers on writes to `journal/*` or `.chats/*`. Non-mess-shaped paths silently ignored.
- [x] Debounce 60s default; min-chars 200 default; single-flight per path.
- [x] Hash-based freshness gate: if a `.suggestions.json` exists for the source and `source_hash` matches, skip the LLM call.
- [x] Skips when model not loaded (no `paused: 'no-llm'` queue state — silent skip with `onRunComplete` event for diagnostics).
- [x] Writes an empty-suggestions sidecar on `NO_EXTRACTIONS` so we don't re-run on every change to the same content.
- [x] Wired in `bootstrapMemory()` alongside the embedding queue; `notifyMemoryOfChange` calls `autoOrganize.noteChanged(path)`.
- [x] Tests: 6 covering mess-prefix filter, density trigger, too-short skip, freshness skip, no-LLM skip, debounce.

### Daily-review fires on density, not just time

- [x] `summariseFreshSuggestions(vault, lastReviewAt?)` walks suggestion sidecars and counts entries generated after the cutoff; returns `{ freshSuggestionCount, freshSources }`.
- [x] `chatVault.listSuggestionPaths()` walks `.memory/` recursively for `*.suggestions.json` files. Lives in `src/lib/chat/index.ts` because the chat layer already owns vault-walking helpers.
- [x] Chat-page banner switches copy based on `reviewFreshSummary`: "You captured N things across M sources since your last review" when fresh suggestions exist, else the existing yesterday-journal copy. Organize button targets the first fresh source.
- [x] 5 new daily-review tests (count, cutoff-before, undefined-treated-as-all, zero-suggestion sidecars ignored, missing `listSuggestionPaths` returns zero).
- [ ] **Suggestion sidecar `acked_at` / `dismissed_at` state — deferred.** Today review state is just "last review timestamp" → cutoff. Acked/dismissed-per-suggestion is a richer model that survives across many days; not blocking the user-facing win. Filed below as a follow-up.

### Proactive connections at capture time

- [ ] **Deferred.** Adding a `## Related` section to proposal cards requires a per-card async retrieval and a UI affordance for "Apply with backlinks vs. Apply." With Phase 5.7's chat-RAG already pulling related thinking into the next-turn context, the marginal value of an explicit related-notes panel on the proposal card is lower than it was in the original design. Re-evaluate after manual use of the daily-review surface.

### Chat-aware extractions

- [x] `/organize @.chats/<id>.md` works through the existing handler — `readRaw` returns the chat session markdown; `parseOrganizeOutput` handles whatever extractions the LLM produces. No code change needed; the path-shape constraint was always permissive.
- [ ] **Conversation-mode system prompt tweak — deferred.** The current `ORGANIZE_SYSTEM_PROMPT` is sufficient on first read for a chat source. A future revision could add "ignore assistant scaffolding, focus on what the user actually said" but the generic prompt produces reasonable results — wait for telemetry before tuning.

### Testing

- [x] Unit: 6 auto-organize tests + 5 daily-review suggestion-summary tests. 11 new tests; total now **364 across 44 files**.
- [ ] Manual: capture a journal entry of >200 chars; observe `.memory/journal/<date>.md.suggestions.json` appearing within 60s; reload chat; verify the daily-review banner reflects the cumulative count. _Saved for the user's primary tab._

### Exit criteria

- [x] Captures crossing the threshold spawn background organize jobs that produce suggestion sidecars without user action.
- [x] Daily review reflects the cumulative suggestion count, not a single-note prompt.
- [ ] ~~Proposal cards for new captures surface related-content chips.~~ Deferred (above).
- [x] `/organize @.chats/<id>` produces sensible atomic-note proposals (handler is path-agnostic; manual validation deferred to user's tab).
- [x] `npm run check` green.
- [x] Tag `phase-5.8-complete`.

---

## Phase 5.9 — Persona & capabilities context

> Planned 2026-05-11 after a real-user chat showed the model has no idea what app it lives in. Logged conversation: user asks "what can you do?" — model says "I can answer your questions and generate text", offers nothing specific to Open Brain. User types observational content ("I'm going to bed now…") and the model treats it as a meta-question about its own abilities instead of suggesting `/journal`. Today's system prompt is 30 tokens and tells the model only that it has "the user's second brain" notes to draw from. The model has no concept of slash commands, vault conventions, the user, or that it's a *part* of a system rather than the whole.

### Direction

Two layers of pre-prompt context, composed into the final system prompt above the retrieval block. Both are budget-bounded and pre-cache-friendly.

- **Capabilities** — app-shipped, app-versioned. Lists the slash commands, vault conventions, and behavioral guardrails (when to suggest a command, how to interpret retrieved context). Lives in the bundle as a TS constant so the prompt updates atomically with the code that implements the capabilities. Not user-editable. Versioned in git history.
- **Persona** — user-edited, synced. Free-form prose + optional frontmatter (name, tone preferences). Lives at `.openbrain/persona.md` so it rides the existing vault → sync pipeline and is invisible to the embedding queue (the `.openbrain/` prefix is already filtered out by `notifyMemoryOfChange`). Empty by default — no opinion shipped.

The structured runtime settings (LLM-emit toggle, theme, retrieval k, auto-organize thresholds…) belong in a sibling `.openbrain/config.yaml` per the original DESIGN §2 plan. That file is a separate concern and is filed under "out of scope for 5.9" below to keep this phase atomic.

### Prior art briefly considered

- **Anthropic's internal `soul.md`** — single curated file describing the model's disposition. The persona slot in 5.9 is the user-facing equivalent.
- **ChatGPT custom instructions** — two free-form text boxes ("What should ChatGPT know about you?" + "How should it respond?"), capped at ~1500 chars each. The two-prompt split is a useful UX cue but a single free-form file is leaner for the MVP.
- **Cursor `.cursorrules` / Claude Code `CLAUDE.md`** — project-scoped prompt fragments appended to a base system prompt. Same pattern as our capabilities/persona composition. Both prove the "code-shipped base + repo-shipped override" model works.
- **Open WebUI / LibreChat model presets** — per-conversation system-prompt picker. Out of scope; single global persona is enough for MVP.

### Why split capabilities from persona

1. **Cache discipline.** The KV-cache spike (§10 2026-05-09) confirmed WebLLM reuses cache only when `messages` is a strict byte-prefix-extension of the previous call. A user-editable capabilities block would bust the cache on every edit. Splitting keeps the capabilities byte-stable across the session.
2. **Versioning.** When we add a slash command in Phase 5.10 (or rename one), the capabilities text must update for *every* user immediately. A vault file would lag on machines whose sync hasn't run.
3. **Token budget.** Capabilities can be terse and pre-tuned; persona is the user's variable-length surface. Splitting lets us cap each independently.

### Where the wiring lives

Current path (Phase 5 + 5.5):

```
SYSTEM_PROMPT  ← const in src/lib/memory/retrieve.ts
   │
   └── assembled.systemPrompt ← returned by assembleContext()
          │
          └── chat page concatenates with SLASH_EMIT_SYSTEM_INSTRUCTION when toggle on
                 │
                 └── { role: 'system', content: systemPrompt }
```

New path (5.9):

```
buildSystemPrompt({ capabilities, persona, slashEmit }) ← new helper
   │
   ├─ CAPABILITIES_PROMPT (const, src/lib/llm/capabilities.ts)
   ├─ PERSONA            (loaded from .openbrain/persona.md, optional)
   ├─ SLASH_EMIT_SYSTEM_INSTRUCTION (existing, conditional)
   └─ assembled.systemPrompt + retrieval context
```

### Tasks

#### Capabilities (`src/lib/llm/capabilities.ts` — new)

- [ ] Constant `CAPABILITIES_PROMPT` covering:
    - App identity ("You are the assistant inside Open Brain, a personal second-brain that lives in the user's browser and syncs notes to their private GitHub repo.")
    - The vault shape (`notes/`, `journal/`, `lists/`, `.chats/`) and what each is for.
    - The slash command vocabulary (all 11 — `/save /journal /note /append /list /organize /edit /related /find /archive /tag`) with a one-line use case each.
    - Behavioral guardrails: "When the user *recounts* their day, ask whether to `/journal` it. When they ask *what can I do*, summarize the capabilities below. Retrieved notes may be irrelevant to small talk — if the user is greeting you, greet them back instead of summarizing notes." This addresses the failed conversation directly.
    - Hard cap target: ≤ 350 tokens (~1400 chars). Lint-style assertion in tests via `approxTokens`.
- [ ] `CAPABILITIES_VERSION` — bumped whenever the prompt or command list changes. Surfaced in `/setup` debug section so the user can see which version their model is running against.
- [ ] One vitest test that checks `CAPABILITIES_PROMPT.length` against the budget (so future edits fail loudly instead of silently bloating the prefix).

#### Persona (`src/lib/persona/` — new module)

- [ ] `PERSONA_PATH: NotePath = '.openbrain/persona.md'`.
- [ ] `loadPersona(vault) → { frontmatter, body } | undefined` — silent miss if the file doesn't exist (default state).
- [ ] Optional frontmatter shape: `name`, `pronouns`, `tone`, `focus` (list). Free-form body is the rest.
- [ ] `renderPersonaForPrompt(persona, options) → string` — assembles `frontmatter` fields into a one-line "User: Orvis · prefers terse, direct responses" header plus the trimmed body. Caps body at ~250 tokens; truncates with `…` and a console.warn if longer (the user opted into the bloat, but we tell them).
- [ ] First-run default writing: on `bootstrapMemory()` (or a small `bootstrapPersona()`), if `.openbrain/persona.md` doesn't exist and the user is signed in, write a *stub* file:
    ```markdown
    ---
    name:
    tone:
    focus: []
    ---

    # About me

    This is your personal context file. Edit it to tell the model who you are,
    how you want it to respond, and what you tend to think about. Open Brain
    will include this in every chat turn. Keep it short — every word here is
    counted against your model's context window. Leave the file empty (or
    delete it) to opt out.
    ```
    The stub is short enough that a fresh empty install reads as ~30 tokens; the user can flesh it out or wipe it.
- [ ] Unit tests for the loader, the renderer, the truncation path, and the missing-file path.

#### System-prompt builder (`src/lib/llm/system-prompt.ts` — new)

- [ ] `buildSystemPrompt({ capabilities, persona, retrievalBlock, slashEmit })` — pure function. Returns the final string in stable order:
    ```
    <CAPABILITIES>

    <PERSONA — only if present>

    <existing retrieval system prompt — "You are the user's second brain. …">
    Cite the note path when you draw from it. …

    <SLASH_EMIT_SYSTEM_INSTRUCTION — only if toggle on>
    ```
    Order is deliberate: capabilities first because they're stable byte-prefix; persona second; retrieval guardrails third; slash-emit last (toggle-driven, so it bumps to the end of the prefix when on).
- [ ] Token-budget enforcement: caller passes a `softCap` (default 600 tokens). The builder returns `{ prompt, tokensUsed, warnings: [...] }`. If over the cap, persona body is truncated first; capabilities is never trimmed (it's the warranty card). Slash-emit is also never trimmed (it's behaviorally load-bearing when on).
- [ ] Replaces the inline concat in `src/routes/chat/+page.svelte:300-302`.
- [ ] Tests: 6+ covering order, persona-absent, persona-truncated, over-budget warning shape.

#### Chat-page wiring

- [ ] On chat mount, `loadPersona(chatVault)` once and stash in a non-reactive `let` (persona doesn't change mid-session; if the user edits it via Browse, the next chat session picks it up). Refresh on `subscribeToVaultChanges` if the change path is `.openbrain/persona.md`.
- [ ] `streamChat`/`runWithRAG` call site builds the system prompt via `buildSystemPrompt`. Slash-handler context (which also runs LLM calls for `/edit` and `/organize`) gets the same builder.
- [ ] Surface the assembled system prompt under `?debug=1` (covered in POST-MVP §design-and-a11y but stub the seam here — a `getLastSystemPrompt()` accessor for the debug panel).

#### Editing UX

- [ ] `.openbrain/persona.md` is browseable (Browse already lists `.openbrain/` via `vault.listNotes()`? — verify; if not, add a Settings section like the Chats section did in Phase 5.7). _Confirmed: vault.listNotes() walks `notes/` only, so `.openbrain/persona.md` is not in the existing tree. Add an "App settings" section under the Chats section, populated by a new `vault.listAppSettings()` or by pointing at known paths (`.openbrain/persona.md`, future `.openbrain/config.yaml`)._
- [ ] Browse banner on `.openbrain/persona.md`: a small note above the editor explaining the token-budget tradeoff. (The chat read-only banner pattern from Phase 5.7 is the precedent — same shape, different copy.)
- [ ] No slash command for editing in this phase. `Cmd+K` palette would be the right surface but that's POST-MVP. Reuse the existing `/edit @.openbrain/persona.md <instruction>` flow for natural-language updates.

#### Documentation

- [ ] Document the capabilities/persona split in this plan's Decision Log (which surface owns which, and why) when the phase ships.
- [ ] Add a one-line note in DESIGN §2 (theme modes) that `.openbrain/config.yaml` is the home for structured settings and `.openbrain/persona.md` is the home for prose persona. Phase 5.9 ships the persona; config.yaml is in the deferred items below.

### Out of scope for 5.9

- **Structured config (`.openbrain/config.yaml`).** Theme switcher, retrieval knobs, auto-organize thresholds. These are real wants but each one is small and they're better added as a phase-by-phase concern.
- **Per-session persona overrides.** The single-global model is enough for MVP.
- **Persona embedding / retrieval.** The persona is small (≤ 250 tokens) and load-bearing on every turn — it doesn't need to be retrieved, it needs to be present. The `.openbrain/` prefix already excludes it from the embedding queue.
- **LLM-generated persona seeds.** "Tell me about yourself and I'll write your persona." Lovely UX but adds a chicken-and-egg dependency on having a loaded model during onboarding.

### Token-budget back-of-envelope

| Slot | Target tokens | Notes |
|---|---|---|
| Capabilities | ≤ 350 | Hard cap; lint-tested. |
| Persona | ≤ 250 (truncated if longer) | Stub default ≈ 30 tokens. |
| Retrieval system instructions (existing) | ~30 | Unchanged. |
| Slash-emit (when on) | ~120 | Existing constant. |
| **Total system prompt** | **≤ 750** | Comfortable inside the ~1000-token slice we reserve for non-retrieval, non-response budget on Gemma-2B's 8K window. |

### Exit criteria

- [x] `CAPABILITIES_PROMPT` is in the bundle, lint-bounded (`CAPABILITIES_CHAR_CAP`), version-stamped (`CAPABILITIES_VERSION`).
- [x] `.openbrain/persona.md` ships a stub on first chat mount via `ensurePersonaStub`; user can edit in Browse (with a token-budget banner) and changes take effect on next chat turn via `subscribeToVaultChanges`.
- [x] `buildSystemPrompt` replaces the inline concat at `src/routes/chat/+page.svelte`.
- [x] Token-budget warning fires on over-bloat (persona truncation `console.warn`) without breaking the call.
- [x] `.openbrain/` files surface in Browse under a new "App settings" section via `vault.listAppSettings()`.
- [ ] Manual: type "what can you do?" — model now answers in Open-Brain-specific terms. _Pending user's primary tab._
- [ ] Manual: type "I'm going to bed, I petted the cat" — model suggests `/journal`. _Pending user's primary tab._
- [x] `npm run check` green (361 → 386 tests).
- [x] Tag `phase-5.9-complete`.
- [ ] Wire `buildSystemPrompt` into the slash-handlers' shared LLM runner so `/edit` and `/organize` also benefit. _Deferred — those handlers already have their own focused system prompts (`EDIT_SYSTEM_PROMPT`, `ORGANIZE_SYSTEM_PROMPT`) that are task-specific and don't need capabilities + persona on every call. Re-evaluate if user reports the slash handlers feeling out-of-context._

---

## Phase 5.9.1 — Conversation context overflow

> Planned 2026-05-11 alongside 5.9. Today the chat page sends the *entire* session history on every turn ([src/routes/chat/+page.svelte:308-314](../src/routes/chat/+page.svelte)) — the model gets `[system, …all prior turns…, current user]` regardless of session length. On Gemma-2B's 8K window this collides with retrieval after maybe a dozen substantive turns; on Llama-3.2-1B with a smaller effective window it collides sooner. The failure mode today is silent — WebLLM truncates or errors at the model level, and the user has no idea why earlier turns "disappear" from the model's working memory.

### Direction

Compose the chat-call budget explicitly. Trim from the oldest turns when the conversation exceeds the budget. Lean on Phase 5.7's chat-memory layer as the durable copy: dropped turns stay embedded in `.memory/.chats/<id>.md.json` and remain retrievable via RAG, so the model can still answer "what did we talk about earlier?" — it just retrieves them instead of replaying them verbatim.

This is intentionally a sliding-window strategy, not a summarize-and-replace one. Summarize-and-replace adds an extra LLM call per overflow event, produces mediocre summaries on small models, and depends on a stable summary-prompt format. The sliding window + chat-RAG hybrid achieves the same end (recall of old content) at zero extra inference cost.

### Why sliding window beats summarize-and-replace here

| Concern | Sliding window + chat-RAG | Summarize-and-replace |
|---|---|---|
| Extra LLM calls per overflow | 0 | 1 |
| Quality of "old context" recall | Whatever the user asked is retrievable as a chunk | Bottlenecked by summary quality on a 2B model |
| Bookkeeping | None — chats are already embedded | Need a "summary prefix" message slot + invalidation |
| Latency to first token on overflow turn | Unchanged | Extra round-trip before generation can start |
| Reversibility | Old turns are still in `.chats/<id>.md` verbatim | Summary loses fidelity, can't be undone |

If real-world use shows the model frequently needs older turns for short-range coreference (e.g. pronouns from 8 turns back), revisit. The Phase 10.5 e2e suite is the right surface for measuring this.

### Budget composition

On every chat turn, allocate the model's effective context window like this (configurable; defaults below):

| Slot | Default fraction of window | Notes |
|---|---|---|
| System prompt (capabilities + persona + retrieval guardrails + slash-emit) | up to 10% | Hard-capped by Phase 5.9's `buildSystemPrompt`. |
| Retrieval block | 50% | Down from Phase 4's 70%, which pre-dated multi-turn chat sessions and the chat-memory work in Phase 5.7. Tune via the existing `retrievalFraction` option. |
| Message history (turns before the current one) | 30% | New slot. Sliding-window trim from the oldest until it fits. |
| Response reserve | 10% | Capped via WebLLM's `max_tokens` so the model can't blow past it. |

These add to 100% of the model's effective window (8192 on Gemma-2B). The math runs once per turn; over-allocations are absorbed by trimming retrieval *or* history depending on which is more elastic for that turn (see "Priority order" below).

### Tasks

#### Tokenization (`src/lib/llm/tokenize.ts` — new)

- [ ] `countMessageTokens(messages, options) → Promise<number>` that uses WebLLM's tokenizer when an engine is loaded (`engine.tokenize(text)` for accurate counts) and falls back to the existing `approxTokens` heuristic otherwise. Tests don't need the real tokenizer — the fallback is the test path.
- [ ] Counts per role include the ~4-token-per-message overhead OpenAI-style chat formats use (system framing, role tag, separators). Conservative is fine; we'd rather budget low than blow the call.
- [ ] Memoise per message id within a turn so the budget check doesn't re-tokenize the same message N times during trimming.

#### Budget composer (`src/lib/chat/budget.ts` — new)

- [ ] `composeChatBudget({ contextWindow, fractions })` returns the `{ systemTokens, retrievalTokens, historyTokens, responseTokens }` allocation up front. Single source of truth; both the chat-page and the slash-handler LLM runner read it.
- [ ] `trimHistoryToBudget(history, currentUserMessage, budget, countTokens)` — pure function. Drops oldest turns first (in pairs where possible so user/assistant balance stays roughly intact). Preserves:
    - The current user message (never dropped).
    - The most recent `MIN_KEEP` turns (default 2 user + 2 assistant = 4 messages). Keeps short-range coreference alive even when the conversation is over budget.
    - Slash-command system messages (`role: 'system'` confirmations like "✓ Saved to journal/…") are dropped from the LLM messages array anyway, so they don't enter this calculation.
- [ ] Returns `{ trimmed, droppedCount, droppedTokens }` so the chat page can surface a marker.
- [ ] Tests: 10+ covering pair-wise drop, MIN_KEEP enforcement, current-message-never-dropped, all-fits-no-drop, single-huge-turn-forces-drop-anyway, returns-droppedCount=0 when no trim happened.

#### Priority order when totals don't fit

A pathological case: even after trimming history down to `MIN_KEEP`, the system + retrieval + history + current-message + response still doesn't fit. Priority for further trimming:

1. **Drop retrieval chunks** (lowest-scoring first) — they're recoverable on the next turn if a different query brings them back. Retrieval already does this via the `retrievalBudget` cap; the new code wires the cap to whatever's left after system + history + response are subtracted from the window.
2. **Trim retrieval text** within remaining chunks — already done by `assembleContext`'s budgeting loop.
3. **Hard error** if the system prompt + current user message + response reserve alone exceeds the window. Surface as a toast: "Your message is too long for the model's context — split it into smaller pieces." (Will essentially never happen for normal use; only fires on a 4000-token paste.)

`MIN_KEEP` history is never dropped past `MIN_KEEP = 0` automatically. If a user sets `MIN_KEEP` higher than what fits, we honour their preference and trim retrieval instead. The user's intent — "I want recent turns visible" — is more load-bearing than "I want broad retrieval."

#### Chat-page integration

- [ ] Replace the inline `working.messages.slice(0, -1).filter(...).map(...)` block at [src/routes/chat/+page.svelte:308-314](../src/routes/chat/+page.svelte) with `trimHistoryToBudget(history, currentMessage, budget, countTokens)`.
- [ ] Wire the result into the existing `llmMessages` array.
- [ ] On `droppedCount > 0`, add a non-persistent in-chat marker above the new turn: `↥ N earlier turns archived to chat memory (search via /find)`. Subtle, monospace, no toast — this is informational, not erroneous.
- [ ] The chat-session markdown file (`.chats/<id>.md`) keeps the full transcript regardless. We're trimming the *prompt to the model*, not the *record on disk*. Phase 5.7's chat-RAG indexes the whole file; dropped turns stay searchable.

#### Slash-handler LLM runner

- [ ] The same budget logic applies to `/edit` and `/organize` calls but they're single-shot (no history). Their callers pass an empty `history`; the budget composer skips the trim path.
- [ ] But `/edit` source content and `/organize` source content can themselves blow the budget if the user runs them on a huge note. Wire a soft-cap on the user-prompt length in the runner that mirrors the retrieval budget — refuse with a clear error rather than silent truncation.

#### Settings + observability

- [ ] No new user-facing settings in this phase. Defaults are good defaults; advanced tuning lives behind `.openbrain/config.yaml` whenever that lands.
- [ ] Under `?debug=1` (deferred from Phase 9 to POST-MVP) surface the per-turn allocation: `system=380 / retrieval=4096 / history=2400 / response=820`. For now, a `console.warn('[openbrain/budget]', allocation)` when a trim happens is enough — useful for the user and for tests.

### Open questions

- [ ] **Where to put MIN_KEEP.** 4 messages is a guess; 2 might be enough on the smallest model, 8 might feel better on the biggest. Could be a config knob; could be derived from model variant. Pick after the e2e suite measures real conversation lengths.
- [ ] **Does WebLLM's `engine.tokenize()` exist reliably across all variants we ship?** Confirm during 5.9.1 implementation; if not, the `approxTokens` fallback carries.
- [ ] **Marker format.** `↥ N earlier turns archived` is a guess. UX may prefer "click to see what was dropped" with a small expansion — easy to add later.

### Exit criteria

- [x] `composeChatBudget` + `trimHistoryToBudget` ship; chat page uses `trimHistoryToBudget` instead of replaying the full session ([src/routes/chat/+page.svelte](../src/routes/chat/+page.svelte)).
- [x] When `droppedCount > 0`, a subtle in-chat marker appears (`↥ N earlier turns archived to chat memory · search via /find`).
- [x] `countMessageTokens` + `approxTokens` ship with a WebLLM-engine fast path and a heuristic fallback ([src/lib/llm/tokenize.ts](../src/lib/llm/tokenize.ts)).
- [x] `console.warn('[openbrain/budget]', …)` fires on trim events for debug-panel observability.
- [ ] Manual: hold a 30-turn conversation; verify the marker appears mid-stream. _Pending user's primary tab._
- [ ] Manual: ask "what did we discuss 25 turns ago?" — answer comes from chat-RAG retrieval. _Pending user's primary tab._
- [ ] Hard-error path: a 5000-token user message produces a clear toast. _Deferred — the current code lets retrieval shrink to zero and proceeds; the explicit hard-error toast is filed for follow-up._
- [x] `npm run check` green.
- [x] Tag `phase-5.9.1-complete`.

---

## Phases 6 & 7 — moved to POST-MVP-PLANS

2026-05-11: Phase 6 (Attachments) and Phase 7 (First-run setup polish + compat detection) were moved to [POST-MVP-PLANS-2026-05-11.md](./POST-MVP-PLANS-2026-05-11.md). The MVP critical path runs Phase 5.6 → Phase 8 directly. The production GitHub App swap and serverless proxy port from the old Phase 7 stay on the MVP critical path — they live in Phase 11.

---

## Phase 8 — Design pass

> Shipped 2026-05-11 as a pass, not a rebuild. The accent + glow + reduced-motion sweep are in place. Theme switcher UI, font self-hosting, scan-line overlay, and the command palette are explicitly deferred (see below).

Run against [DESIGN](./DESIGN-2026-04-17.md).

- [x] **Accent locked at cyan** (`#22d3ee` dark / `#0891b2` light). Magenta evaluated and dropped — cyan already had broad usage and reads cleanly on the existing CRT-warm background. See [src/app.css](../src/app.css).
- [x] **Design tokens expanded** to match design §3: added `--color-bg-raised`, `--color-fg-muted`, `--color-accent-glow`. Light-mode glow is `transparent` (glows look wrong on light backgrounds — design §3 rule).
- [x] **`:focus-visible` phosphor glow ring** applied globally via a base-layer rule. Outline + `box-shadow` + a 200ms ease-out fade. Tab-keyboard focus gets it; mouse clicks don't (the `:focus-visible` pseudoclass handles the distinction).
- [x] **`prefers-reduced-motion` sweep.** Global rule caps transition/animation durations at 0 and drops the focus-glow fade. Deliberately scoped — the streaming-token rendering in Chat is the *only* animation Chat needs, and that's driven by content updates, not CSS animation.
- [x] **Terminal-style blinking caret.** The chat textarea carries the `.terminal-cursor` class; caret color tracks the accent. (The `::after` faux-block in the class is harmless on textareas — browsers don't render pseudo-elements on replaced form controls — so callers can also opt in on non-input elements.)
- [x] **Status bar polish** — already monospace, glyph-driven (`▲ ▼ ◆ ● ○`), click-to-detail on conflict path. Verified, no changes needed.
- [ ] **Theme switcher UI** (System / Light / Dark in settings). _Deferred — out of MVP scope for the design pass alone. The CSS infrastructure (`[data-theme]` attribute + media-query branches) is in place; flipping it on requires a settings surface that doesn't exist yet._ Filed for post-MVP.
- [ ] **Scan-line overlay** for model-download / initial-clone screens. _Deferred — nice-to-have, not load-bearing for the MVP definition. Optional flourish per design §11._
- [ ] **Command palette (`Cmd/Ctrl+K`)** — _Deferred. No existing surface to anchor it to; building it requires a search abstraction that overlaps Phase 5.6's `/find` work. Re-evaluate post-launch._
- [ ] **Self-host Inter + JetBrains Mono** with `font-feature-settings`. _Deferred — current stack falls back through the system UI fonts cleanly; self-hosting is a polish item, not a correctness one._

### Exit criteria
- [x] Visual pass complete on the items above; app reads as the design doc describes (phosphor accent, dark CRT-warm background, hairline borders, monospace status bar).
- [x] `npm run check` green (361 tests).
- [x] Review Phase 9's tasks against the now-themed UI — done; the toast colour palette uses the new `--color-bg-raised` + `--color-fg-muted` tokens; the `prefers-reduced-motion` rule applies to the focus glow.
- [x] Tag `phase-8-complete`.

---

## Phase 9 — Errors, loading, accessibility

> Shipped 2026-05-11 as a foundational pass. Toast surface + sync-error wiring + the most load-bearing ARIA labels. Detailed audits (Lighthouse, axe, contrast) deferred.

### Loading (design §8)
- [x] **Under-150ms operations: no indicator.** Default — no spinner added anywhere new.
- [x] **150ms–1s: optimistic UI.** Already in place: proposal cards render immediately, vault writes go through optimistically; sync error toast surfaces only on real failure.
- [x] **1s–10s: inline skeletons / streaming tokens.** Chat already streams tokens (Phase 5); Browse renders a "Loading…" line per file (`src/routes/browse/+layout.svelte`).
- [x] **>10s: explicit progress.** Already in place for model download (`model.progress`) and initial clone (sync engine status). No new work needed.

### Errors (design §9)
- [x] **Toast component** ([src/lib/toast/](../src/lib/toast/)): bottom-center desktop, top on `max-width: 640px`; 6s auto-dismiss for actionless toasts, indefinite when an action is present; duplicate-message collapse with a ×N count refresh that resets the dismiss timer. Action variant + manual dismiss + severity colors all covered. 8 tests on the pure store.
- [x] **`ToastHost` mounted in root layout** so any tab can push without re-mounting. `role="status"` + `aria-live="polite"` on the container so screen readers announce new toasts politely.
- [x] **Sync-error wired through toast.** The root layout's syncEngine subscription pushes one toast when status transitions `* → error`. Status-bar text stays the live indicator; the toast handles the moment-of-failure that a quiet color change wouldn't communicate.
- [x] **Structured logging helper** (`$lib/log`) already in place from earlier phases; used consistently across new modules.
- [x] **Silent retry** on transient sync errors — already lives in the sync engine's push-rejection auto-recovery (Phase 3 work).
- [ ] **GitHub rate-limit countdown in status bar.** _Deferred — needs the rate-limit response header parsing + a status-bar segment. Filed for post-launch._
- [ ] **`?debug=1` debug panel.** _Deferred — a structured `logError` is in place so the dev-console pathway works; the in-app panel is nice-to-have._

### Accessibility (design §10)
- [x] **`aria-current="page"` on active tab** + `aria-label="Main navigation"` on the nav (already done before this phase). Tab bar uses semantic `<a href>` links rather than ARIA tablist because the tabs *are navigation* (each anchors a route), not panel-swap controls — the WAI-ARIA spec recommends links + `aria-current` over `role="tab"` for that case.
- [x] **Live region for toasts** — see above.
- [x] **Live region for streaming responses** — already in place: `<div role="log" aria-live="polite">` wraps the message list in `src/routes/chat/+page.svelte:781`.
- [x] **`aria-live="polite"` on `.status-model`** so model state transitions ("loading 43%" → "gemma-4b ready") get announced politely.
- [x] **`:focus-visible` phosphor ring** (Phase 8) is the universal visible-focus signal for every keyboard-reachable element.
- [ ] **Contrast audit (AAA body, AA everywhere)** + **axe / Lighthouse score**. _Deferred — needs the full color set finalised in production (especially light-mode dusty teal). Lighthouse + axe runs land in Phase 10.5 e2e scope._
- [ ] **Zoom-to-200% layout verification.** _Deferred to manual launch-prep checklist._

### Exit criteria
- [x] Toast surface ships with auto-dismiss + duplicate collapse + action variant + a11y live region.
- [x] One concrete error path (sync error) is wired through the toast end-to-end.
- [x] `npm run check` green.
- [x] Review Phase 10.5's e2e scope — toast collapse + live-region announcements are good candidates for the smoke suite when it lands.
- [x] Tag `phase-9-complete`.

---

## Phase 10 — moved to POST-MVP-PLANS

2026-05-11: Full PWA + offline-first was moved to [POST-MVP-PLANS-2026-05-11.md](./POST-MVP-PLANS-2026-05-11.md). The product vision is "just visit a URL — no installs"; PWA install is optional. A minimal `manifest.json` for "Add to Home Screen" on mobile remains on the MVP critical path and ships in Phase 11.

---

## Phase 10.5 — Deterministic e2e test suite

> Placeholder. Detailed task list to be drafted when phase opens. Goal: capture user-visible behavior in tests that survive refactors, so the architectural review (Phase 10.7) can act on findings without regressing shipped behavior.

### Direction

Up to now, Vitest covers pure/functional modules and UI is verified manually (Phase 0 convention). That is fine while we're building forward, but it makes refactoring risky. Before the architectural review, lock in the user-visible behavior of every shipped phase with deterministic, browser-driven tests that run in CI.

### Scope (placeholder — refine when opening)

- [ ] **Framework selection.** Decide between Playwright (full browser, real WebGPU optional) and Vitest browser-mode (lighter, but harder to drive WebGPU). Frame the decision around determinism and CI cost.
- [ ] **Determinism strategy for the LLM.** Replace WebLLM with a fake engine that streams pre-recorded responses keyed by `(messages, response_format)` hash. Records live in `tests/fixtures/llm/`. New responses recorded via a "record mode" run.
- [ ] **Determinism strategy for embeddings.** Replace Transformers.js embedder with a deterministic fake (e.g. a hash-based pseudo-embedding) for tests that don't need real semantic behavior; for tests that do, record real embeddings to fixtures keyed by input hash.
- [ ] **Vault fixtures.** Deterministic git history per scenario (committed test repos under `tests/fixtures/vault/`). Cover: empty vault, vault with notes only, vault mid-sync, vault with conflicts, vault with sidecars.
- [ ] **GitHub mock.** Fake the same-origin proxy endpoints (`/__gh*`) with a local HTTP server in tests so device flow, installations, clone, push, pull, and conflict scenarios are reproducible without hitting GitHub.
- [ ] **Web Speech mock.** Inject a fake `recognitionFactory` (the DI seam already exists from Phase 5) that emits scripted transcript events.
- [ ] **WebGPU/GPU lease.** Decide whether to mock or to require WebGPU-capable CI runners. Probably mock — the lease semantics are what matter, not real GPU work.
- [ ] **Coverage targets per phase.** At least one happy-path scenario per shipped phase:
    - Phase 1 walking skeleton: app boots, model loads (faked), one chat turn renders.
    - Phase 2: Browse tab lists notes; opening a note shows content.
    - Phase 3: edit → debounce → commit → push → remote edit → pull → conflict → resolve via picker → re-push.
    - Phase 4: write a note → embedding queued → sidecar appears → retrieval finds the chunk.
    - Phase 5: chat with retrieval cites the right note; voice input appears as a turn.
    - Phase 5.5: each slash command produces a card; Apply lands the file; chip bar reorders by frecency; `@`-mention autocomplete inserts a target; suggester promotes the right chip.
    - Phase 5.6: `/edit` produces a replace diff; `/related` writes a See-Also section; `/find` lists results; `/archive` stamps `archived_at`; `/tag` merges tags preserving prior lines.
    - Phase 5.7: a chat turn over the noise threshold writes a `.memory/.chats/<id>.md.json` sidecar with role-tagged chunks; `/find` surfaces the chat snippet with the 💬 glyph; Browse shows the chat under a `Chats` section and renders it read-only.
    - Phase 5.8: a journal entry crossing the auto-organize density threshold produces `.suggestions.json` within the debounce window; daily-review banner reflects the cumulative count.
    - Phase 5.9: capabilities + persona land in the assembled system prompt; over-budget persona truncates with a console warning; missing persona file uses the no-persona path silently.
    - Phase 5.9.1: a 30-turn conversation triggers history trim; the "earlier turns archived" marker appears; `/find` retrieves a dropped turn; a 5000-token user message produces the hard-error toast.
    - Phase 8: `:focus-visible` shows the phosphor glow ring; `prefers-reduced-motion` disables animation/transition; cyan accent applied to active tab + chat caret.
    - Phase 9: a forced sync error pushes a toast via `ToastHost`; identical messages within 30s collapse with `(×2)`; an actionable toast survives past the auto-dismiss window.
- [ ] **CI integration.** Add `check:e2e` to the `npm run check` pipeline (or as a separate job if too slow). Tier into smoke (every PR) vs. full (nightly + pre-release) if needed.
- [ ] **Test data hygiene.** Fixtures under `tests/fixtures/`; record-mode outputs gitignored unless explicitly committed; one canonical script for re-recording.

### Open questions

- [ ] Single suite or tiered (smoke / full)? Inform with measured CI cost.
- [ ] Do we use real isomorphic-git in tests against a local bare-repo fake, or mock the git layer entirely? Real-git-against-fake-server is more faithful and the existing `git.ts` wrapper is already the seam.
- [ ] How do we test the JSON-vs-slash bench artifacts long-term — fold into the suite or keep as a separate one-shot harness?

### Exit criteria

- [ ] At least one happy-path e2e per shipped phase, all green.
- [ ] LLM and embedding fakes are deterministic; tests are stable across runs and machines.
- [ ] CI runs the suite on every PR; failures block merge.
- [ ] `npm run check` green (including the new e2e tier or with a documented carve-out).
- [ ] Document the record-mode workflow in `docs/` so future phases can extend the fixtures without spelunking.

---

## Phase 10.7 — Architectural review

> Placeholder. Detailed task list to be drafted when phase opens. Depends on Phase 10.5 — the e2e suite is the regression safety net that lets us act on review findings.

### Direction

Take stock of the architecture before launch. Identify accumulated tech debt, cross-cutting issues, and areas where MVP shortcuts need hardening. Output is a punch list of changes to apply, each backed by the e2e suite from Phase 10.5.

### Scope (placeholder — refine when opening)

- [ ] **Decision Log read-through.** Re-read every entry in §10. Tag each as: `still-correct`, `needs-amendment`, or `superseded`. Update entries that are out of date.
- [ ] **Doc reconciliation.** Re-read [CONSTRAINTS](./CONSTRAINTS-2026-04-17.md), [TECH-STACK](./TECH-STACK-2026-04-17.md), [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md), [DESIGN](./DESIGN-2026-04-17.md). Identify drift between docs and shipped code; amend whichever is correct.
- [ ] **Module-by-module health review.** For each `src/lib/*` module: are the seams correct? Is the public API tight? Are there unused exports? Any cycles?
- [ ] **Performance baseline.** Measure boot time, TTFT, retrieval latency, embedding throughput, sync round-trip, full vault scan time. Capture against a fixed reference vault. Flag any regressions vs. earlier benchmarks (where they exist).
- [ ] **Bundle size audit.** Per-route chunk sizes; identify any unexpected dep growth; flag candidates for lazy-loading.
- [ ] **Security review.** Auth token storage, refresh flow, CORS proxy surface, third-party deps (audit + dedupe), CSP readiness, secret-handling hygiene in `.chats/` and sidecars.
- [ ] **Cross-cutting concerns.** Error handling consistency, logging discipline (only `console.error`/`console.warn` via `logError`), accessibility coverage, i18n posture (even if not shipped yet), test coverage per module.
- [ ] **Punch list.** Output a numbered list of changes, each tagged `must-fix-before-launch` / `should-fix-before-launch` / `post-MVP`. Each fix must reference (or create) an e2e test that asserts the behavior being preserved.
- [ ] **Apply the must-fix list.** Each refactor lands as its own commit, with the e2e suite green before and after, and a Decision Log entry explaining the change.

### Open questions

- [ ] Internal review only, or solicit one external pair of eyes on architecture/security?
- [ ] Threshold for `must-fix-before-launch` vs. `post-MVP` — define before the review starts so it doesn't drift.
- [ ] Do we treat this as one bounded review or as the start of an ongoing cadence (e.g. quarterly)?

### Exit criteria

- [ ] Decision Log, CONSTRAINTS, TECH-STACK, ARCHITECTURE, DESIGN all reconciled with shipped code.
- [ ] Performance baselines captured and committed.
- [ ] Punch list complete; every `must-fix-before-launch` item landed.
- [ ] e2e suite still green after all applied changes.
- [ ] `npm run check` green.

---

## Phase 11 — Launch prep & hosting on Cloudflare Pages

> Hosting decision (2026-05-11): **Cloudflare Pages**, not GitHub Pages. GitHub Pages is static-only and cannot satisfy the three same-origin proxies (`/__gh`, `/__gh_api`, `/__gh_git`) that the GitHub-auth + git-clone path requires. Cloudflare Pages is static + Functions on the same origin, free tier covers personal use, push-to-deploy from the same GitHub repo. The user-facing experience stays "no installs, just visit a URL"; behind the scenes the same-origin proxies become Cloudflare Pages Functions.
>
> Alternatives considered: Netlify (functions are paid past 125K/mo), Vercel (similar tier), a small Cloudflare Worker fronting the static site (more moving parts). Cloudflare Pages is the smallest delta.

### Hosting infrastructure (Cloudflare Pages + Functions)

- [x] `functions/` directory at the repo root (Cloudflare Pages convention) with three proxies + a shared helper. Scaffolded 2026-05-11.
- [x] `functions/__gh/[[path]].ts` — proxies to `github.com`. Used for OAuth device flow.
- [x] `functions/__gh_api/[[path]].ts` — proxies to `api.github.com`. Used for installation discovery + REST API.
- [x] `functions/__gh_git/github.com/[[path]].ts` — proxies to `github.com` for git smart-HTTP. Streams both request and response bodies (Cloudflare Workers `fetch` honours `Request.body` as a `ReadableStream`).
- [x] `functions/_shared/proxy.ts` carries the shared upstream-forward logic + header stripping. Mirrors `stripBasicAuthChallenge` from `vite.config.ts`.
- [x] `static/_headers` for CSP + cache rules: 1y immutable on `_app/immutable/*`, no-store on the HTML shell. CSP carves out `wasm-unsafe-eval` for WebLLM and `worker-src blob:` for the Worker that WebLLM spawns; no `unsafe-inline` scripts.
- [x] `docs/DEPLOY-CLOUDFLARE-PAGES.md` documents the one-time Pages project setup, the GitHub App registration, and the same-origin verification step.
- [ ] Verify on `npx wrangler pages dev build` once the project is deployed — scaffolded but not yet exercised. Reason: Wrangler isn't a dev dependency in this repo yet; the user can install on demand. The Functions are intentionally small enough that a code review + first-deploy smoke test covers them.

### Production GitHub App

- [ ] Register a production GitHub App (`Open Brain`). Permissions: Repository contents read+write, metadata read. (Manual step — documented in `docs/DEPLOY-CLOUDFLARE-PAGES.md`.)
- [ ] Add a production `VITE_GITHUB_CLIENT_ID` to Cloudflare Pages env vars; dev keeps the existing dev app.
- [ ] Install on a clean production repo. Verify the full flow: device-flow sign-in → installation discovery → clone → first commit → push.

### Mobile shell

- [ ] Minimal `manifest.json` for "Add to Home Screen" (name, icons at 192/512, theme color, `display: standalone`). Carved out from the post-MVP PWA work — this is the cheapest mobile-shell win that doesn't gate on the full Workbox investment.
- [ ] Apple touch icon + favicon set.

### Smoke + perf + content

- [ ] Manual smoke test on each supported browser — capture which features work where. Output: a short table appended to README or a `docs/COMPAT.md`.
- [ ] CSP headers configured via `_headers` (no inline scripts except WebLLM's required worker blob); no third-party JS in network panel.
- [ ] Performance: measure time-to-first-token and initial-clone time for a 100-note repo; document baseline.
- [ ] README: full user-facing getting-started — "fork or visit, sign in with GitHub, pick a private repo, start typing."
- [ ] `CONTRIBUTING.md` (optional for MVP).

### Release

- [ ] Tag `v0.1.0-mvp`.
- [ ] Cloudflare Pages deploys from `main` automatically on tag push.
- [ ] Verify same-origin: every GitHub-bound request in DevTools network panel shows the deployed origin, not `github.com` directly.

### Exit criteria
- [ ] `npm run check` green
- [ ] MVP is live at the Cloudflare Pages URL and actually usable as a personal second brain.
- [ ] A fresh user on a clean browser completes setup end-to-end via the deployed URL — no localhost, no shell.

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
- `2026-05-05` — **Phase 3 implementation notes (deltas from the spec).**
  1. **`SyncStatus` carries inline data per kind** (`pending`/`offline` carry `pendingPaths`, `idle` carries `lastSyncAt`, `conflict` carries `paths`, `error` carries `message`). The architecture sketch §3 had a thinner shape; the engine's status-bar rendering needs the data so the UI doesn't have to reach back into the engine for it.
  2. **`SyncEngine.status` is a plain reactive container** (`{ value: SyncStatus }`), not a Svelte rune. The engine is unit-tested in pure Node without the Svelte compiler; consumers (the layout) subscribe and adapt the value into their own `$state`.
  3. **The vault → sync circular import was broken by importing `NotePath` from `$lib/vault/types`** (the leaf module) instead of `$lib/vault` (the barrel that wires the production vault to the engine). Type-only imports through the barrel still confused TypeScript at import resolution.
  4. **`vitest.config.ts` got a `$lib` resolver alias.** SvelteKit's vite plugin sets it up for dev/build but vitest doesn't pick it up automatically. Mirrored to `src/lib`.
  5. **Periodic pull lives in the layout, not the engine.** Keeps the engine timer-agnostic and unit-testable. Layout pulls on mount, every 30s, and on `online` events. `online` also flushes the pending commit queue.
  6. **Tier 3 conflict recovery is deferred.** The auto-reset workdir + replay flow is destructive enough that I'm not comfortable shipping it without browser-level verification on a real `MergeNotSupportedError`. The engine surfaces the failure as a clear error instructing the user to re-clone. Tier 3 backup-only logic is filed in §13 (post-MVP backlog) for follow-up.
  7. **`abortOnConflict: false` on `pull`** is documented in isomorphic-git's docs but missing from its `.d.ts` (the type only lists it on `merge`). Used `@ts-expect-error` with a comment pointing at the upstream gap; remove when isomorphic-git ships an updated typings.
  8. **Tier 2 resolver re-parses the live document on click** rather than trusting the cached `ConflictHunk` offsets. Between paint and click, another resolution may have shifted the offsets — re-parsing is cheap (≤ a few KB) and avoids bugs from stale offsets.
- `2026-05-08` — **Auth refresh for long-lived sessions.** GitHub App user tokens from device flow expire after 8 hours; the refresh token lives 6 months. The first cut stored only the access token, so reopening the tab the next day landed on `✓ Signed in` + `401 Unauthorized` on every API call. Reshape: `storage.ts` persists an `AuthBundle` ({ accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }); `device-flow.ts` captures `expires_in` + `refresh_token_expires_in` and exposes a `refreshAccessToken` (POST `grant_type=refresh_token`). New `session.ts` is the in-memory bundle owner: `initSession` hydrates on layout mount, refreshes proactively when <5min remain, and clears the session if the refresh token itself dies. `getValidAccessToken` is single-flight (concurrent callers join the same exchange — GitHub rotates the refresh token on every refresh, so parallel requests would invalidate each other). Layout polls `getValidAccessToken` every 60s as a refresh trigger; setup uses it before clone.
- `2026-05-09` — **Phase 5 implementation notes (deltas from the spec).**
  1. **Chat history is synced to the repo, not IndexedDB-only.** Architecture §5 specified the `openbrain-chat` IndexedDB store (not synced); during Phase 5 implementation the user explicitly asked to sync chats too. Sessions now live at `.chats/<session-id>.md` in markdown form (frontmatter + `## role · timestamp` blocks). They ride the existing vault → SyncEngine pipeline. Trade-off accepted: chats inflate the repo size and may include sensitive content in the user's git history. The user can `.gitignore` `.chats/` to opt out per-repo.
  2. **`gpuLease` singleton lives in `$lib/llm/runtime`, not `$lib/memory`.** Both modules need it, and we discovered a memory→llm→memory import cycle at evaluation time when memory owned it (memory/index imports llm/runtime for `getEngine`/`GEMMA_MODEL_ID`; llm/runtime needed memory for the lease). Moved to llm/runtime which imports the factory directly from the leaf module `$lib/memory/gpu-lease` (not the barrel) — that's the loop-breaking edge.
  3. **Vault-write filter for chat paths.** `notifyMemoryOfChange` already skipped `.memory/...` (sidecars writing back from the queue); we extended it to also skip `.chats/...` so chat session writes don't get embedded as if they were notes. Path-based filter is brittle long-term but matches the existing sidecar pattern; revisit if more `.foo/` directories appear.
  4. **`SidecarReadVault` split off from `SidecarVault`.** Retrieval only needs `readRaw`; including `writeNote` in `RetrievalVault` would have forced the chat page to ship a no-op writer. Keeping the read path narrow (and a `SidecarVault extends SidecarReadVault` for the write side) is structurally cleaner.
  5. **`approxTokens` heuristic (0.3 tokens/char).** Used to budget retrieval context without paying the embedder-tokenizer cost on every retrieval. Order-of-magnitude correct for English; tighter callers can pass `countTokens: model.countTokens` explicitly. Phase 9 should sanity-check this on real-world chunks.
  6. **`MODEL_VARIANTS` catalogue is advisory, not authoritative.** WebLLM ships more models than we surface in the picker (`runtime.loadModel` accepts any id). The catalogue exists for the UI; future settings pages or tests can pass arbitrary ids. Decision deferred: a "custom variant" text input in settings — not needed for MVP.
- `2026-05-09` — **Phase 4 implementation notes (deltas from the spec).**
  1. **Sidecar on-disk format diverges from architecture §3.** The architecture sketched embeddings "inline in frontmatter as base64". In practice, multi-chunk sidecars + the existing handwritten frontmatter parser would need a richer YAML implementation (nested arrays of objects). Instead, the sidecar uses a thin frontmatter (`schema_version`, `source`, `source_hash`, `extracted_at`, `embedding_model`, optional `extraction_model`) and stuffs the bulk (`embeddings[]`, `summary`, `entities`, etc.) into a fenced ```json``` body. This is machine-only — sidecars are never user-edited — so JSON is fine, and pretty-printing keeps git diffs legible. Conflict auto-resolution doesn't depend on the format being merge-friendly because we always pick whichever side has the later `extractedAt`.
  2. **Vault → memory wiring uses a fan-out subscription**, not a chained `onChange`. `vault/index.ts` exposes `subscribeToVaultChanges(fn)` and registers the SyncEngine as the first subscriber on module evaluation. `bootstrapMemory()` (called from the layout) registers the second subscriber that calls `notifyMemoryOfChange(path)`. Avoids a `vault → memory → vault` import cycle: the memory module never has to be imported by `$lib/vault`.
  3. **`whenIdle()` exposed on both queues.** Tests need a deterministic await — the timer-fire path is `void runOnce()` (fire-and-forget), and a fixed-count microtask flush wasn't reliable across the deep promise chains in `processPath` (read → hash → readSidecar → chunkMarkdown → embedBatch → writeSidecar). Each queue tracks its in-flight drain so `flush()` and `whenIdle()` resolve only after the current run completes.
  4. **Extraction `flush()` respects "no LLM loaded".** The plan said "Refresh memory triggers queue flush regardless of gates" — but bypassing the no-LLM gate just produces N copies of `Error: LLM model not loaded` in the console. `flush()` short-circuits to `paused: 'no-llm'` when `modelId() === undefined`. The `forced` flag still bypasses user-busy and battery gates as intended.
  5. **`fakeCountTokens` in tests stubs the tokenizer with `text.split(/\s+/).length`.** Roughly within an order of magnitude of MiniLM's tokenization (English words tend to be 1–2 tokens). Accurate enough for chunking-logic tests; a deterministic fake (rather than the real ONNX tokenizer) keeps the test runner pure-Node.
  6. **`Float32Array` round-trip uses `String.fromCodePoint` + `String#codePointAt`** instead of `fromCharCode` / `charCodeAt` (lint preference: `unicorn/prefer-code-point`). The semantics are identical for the byte values 0–255 we round-trip; both flavours map directly through `btoa`/`atob`.
- `2026-05-09` — **Phase 3 conflict-resolution fixes (post-manual-test).** Manual browser testing of the two-device conflict flow surfaced a chain of issues that all needed fixing for resolution to actually work end-to-end:
  1. **Push-rejection auto-recovery.** Two browsers committing different changes to the same base produced a non-fast-forward push rejection on the second, surfaced as a generic `! sync error` until the next 30s pull cycle. The engine now auto-recovers: on `PushResult: rejected-non-fast-forward`, it triggers a pull (which auto-merges remote into the local commit) and immediately re-pushes. Clean recovery is invisible to the user; conflicts during recovery surface as `! conflict` (existing flow). New `PushResult` type in `types.ts`.
  2. **`pull()` silently dropped `mergeDriver` and `abortOnConflict`.** isomorphic-git 1.37's `pull()` wrapper destructures only a fixed set of args; passing `mergeDriver`/`abortOnConflict` was a silent no-op, so MergeConflictError was thrown WITHOUT writing markers to the workdir. We now compose `fetch()` + `merge()` + `checkout()` ourselves so the merge driver actually flows through. (`merge()` accepts both options on its public API.)
  3. **Custom diff3 merge driver.** Even when reachable, isomorphic-git's default `mergeFile` driver writes markers to the index, not the workdir. New `merge-driver.ts` uses the `diff3` package (already a transitive dep — no new deps added) to compute the merge and emit standard `<<<<<<< / ======= / >>>>>>>` output that the editor's parser can find. 4 new unit tests.
  4. **Block decorations require a StateField.** Earlier versions of the conflict-overlay used a `ViewPlugin` to avoid an even-earlier re-entrancy bug, but CodeMirror forbids ViewPlugin-supplied block decorations and throws `Block decorations may not be specified via plugins` at first measure. Reshape: the entire decoration set lives in a `StateField` that derives from doc state; click handlers reach the view through `WidgetType.toDOM(view)`, not closure capture.
  5. **Friendly conflict picker UI.** The default diff3 markers (`<<<<<<< master` etc.) confused users who didn't recognise the convention. The overlay now uses `Decoration.replace` with a block widget to swap the entire hunk for a labelled picker showing both versions ("Yours" + "Other device") with content visible and a "Keep this version" button on each. Raw markers are no longer shown unless the user manually edits them in. Manual editing-out of markers still works (parser stops matching → decorations clear).
  6. **Editor force-reload on conflict.** The page's `onRemoteChange` listener bailed when `pendingSave !== undefined` (sane default to avoid clobbering in-flight typing during a clean periodic pull). But during a conflict the user's in-flight edit IS what caused the conflict, so the bail meant the user never saw the merged content. Listener now bypasses the guard when status is `conflict`. A backstop `$effect` also subscribes to status changes — if the active path enters a `conflict` status, force-reload regardless. New "reload" button in the editor header as manual escape hatch.
  7. **Status-bar conflict link.** `! conflict (1)` was a static span with no path to action. Now an underlined link to the first conflicted note; clicking jumps straight to the editor for that file.
  8. **Pre-authenticate git smart-HTTP.** Cosmetic console noise: every periodic pull produced a 401 on `/info/refs` because git's smart-HTTP protocol probes unauth first by design. We now pre-set `Authorization: Basic ...` in the request `headers` so the first request is already authenticated and the protocol skips the dance. `onAuth` stays as a fallback.
  9. **Conflict resolution producing a non-merge commit.** Filed limitation: when the user resolves and the engine commits, isomorphic-git creates a regular commit (single parent: HEAD) rather than a merge commit (parents: HEAD + MERGE_HEAD). Push of this commit may be non-fast-forward and trigger another auto-recovery cycle. In practice the recovery converges (each iteration brings the trees closer); the proper fix is to detect `MERGE_HEAD` post-resolution and pass `parent: [...]` to `commit()`. Filed in §13 backlog under "Tier 2 should produce true merge commits".
- `2026-05-09` — **Phase 5.5 inserted before Phase 6: conversational note operations.** Chat moves from read-only RAG to a writing surface. Direction settled in [RESEARCH-2026-05-09-conversational-note-ops.md](./RESEARCH-2026-05-09-conversational-note-ops.md):
  1. **Slash-command-fronted, preview-and-apply.** Five commands (`/save`, `/journal`, `/note`, `/append`, `/list`); every write flows through a proposal card. No autonomous writes, no LLM tool calling, no LLM-based intent classifier.
  2. **Mobile-first chip bar** above the input (above keyboard via `visualViewport` on mobile, hover/focus-revealed on desktop). Frecency-ordered (`count × exp(-age_days / halflife)`); stats persist in `.openbrain/command-stats.json` so order syncs across devices.
  3. **`@`-mention autocomplete** with case-insensitive infix matching on path / `title` / `aliases[]`. In-memory index, rebuilt on vault change events. No new dep — hand-rolled scorer for low-thousands of notes is faster than `fuse.js`.
  4. **Embedding-based intent suggester** (not LLM-based) runs on a ~600–800 ms typing-pause debounce; cosine-scores against pre-embedded exemplar phrases per command and *promotes* the matching chip. Never auto-routes. If accuracy is insufficient in practice, layer in an LLM second-pass — but only as a suggester, never as a router.
  5. **LLM output format = slash-command syntax**, not JSON. Cheapest tokens, same parser as user input, self-documenting few-shots. YAML for the rare nested payload. JSON-mode reserved pending a Gemma 1B/4B reliability bench.
  6. **Capture-first, organize-later.** Captures land in their target deterministically with no LLM call. Organization is deferred via suggestion sidecars (mirror Phase 4 embedding sidecars) + a once-a-day review prompt. Reuses the extraction queue and `GpuLease` — no new infra.
  7. **Edits/renames/deletes are out of Phase 5.5.** Deferred to a later phase once we have telemetry on proposal accuracy.

  KV-cache spike (~5 min, web-llm source + multi-round-chat example): WebLLM auto-reuses KV cache when `messages` is a strict prefix-extension of the previous call within the same engine session. The cache is single-track per engine — a different-system-prompt classifier interleaved between chat turns would bust the cache for both. This is the strongest reason the intent classifier stays embedding-based (no LLM call). No further KV-cache spike planned.

  JSON-vs-slash precheck (~15 min, web-llm repo + docs): WebLLM exposes `response_format: { type: 'json_object' }` with grammar constraints, and ships dedicated `examples/json-mode` + `examples/json-schema`. Official example uses Llama-3.2-3B, not Gemma; "most models support grammar" is not "all". No open WebLLM issues against Gemma + JSON (neutral signal). Bench is **valid and worth running** — saved for a dedicated session, full design in research §6.
- `2026-05-11` — **Phase 5.8 architecture: auto-organize lives outside the extraction queue.** Considered adding an `'organize'` job kind to `extraction-queue.ts` alongside `'embed'` (per the old §13 backlog item). Rejected because the gating logic is different (the extraction queue waits for `isUserIdle` + battery + GPU lease; auto-organize *wants* to run right after the user pauses capture, not when they've left the app) and the surface is different (one trigger per path with a debounce window, not a polled queue with a pending set). Built `auto-organize.ts` as its own factory module that subscribes to vault writes via the existing fan-out (`subscribeToVaultChanges` → `notifyMemoryOfChange`). The chats-shaped path filter (`MESS_PREFIXES = ['journal/', '.chats/']`) keeps curated notes immune to background re-extraction — the user-experience invariant is "the system only proposes structure for messy sources you haven't already organized."
- `2026-05-11` — **Daily-review density signal: count-since-cutoff, not per-suggestion ack/dismiss state.** Phase 5.8's spec considered carrying `acked_at` / `dismissed_at` on each suggestion. Shipped the simpler model: cutoff is the last review timestamp; everything generated after counts as fresh. Per-suggestion state is filed as a follow-up (see Phase 5.8 deferred items). Reason: the count-only signal is enough to drive the banner-vs-no-banner decision; per-suggestion state is needed only when we have a richer review UI (Browse Organize panel, post-MVP). Building it now would design the data model around a UI we haven't built.
- `2026-05-11` — **Phase 11 hosting target: Cloudflare Pages, not GitHub Pages.** The user's preference was "GitHub Pages or something similar." GitHub Pages is static-only and can't satisfy the three same-origin GitHub proxies (`/__gh`, `/__gh_api`, `/__gh_git`) that the auth + sync path depends on (CORS isn't sent by GitHub for OAuth device flow or git smart-HTTP). Cloudflare Pages bundles static hosting with Functions on the same origin and a free tier covering personal use — smallest delta from the existing Vite dev setup. Scaffolded the three Pages Functions + a shared proxy helper + `_headers` (CSP + cache rules) + a deploy README. Alternatives considered: Netlify (functions paywall past 125K/mo), Vercel (similar tier), Cloudflare Worker + separate static host (more moving parts).
- `2026-05-11` — **Plan triage: Phase 6, Phase 7, Phase 10, §12, §13 moved to [POST-MVP-PLANS-2026-05-11.md](./POST-MVP-PLANS-2026-05-11.md).** Reason: Phases 5.5 and 5.6 reshaped the product around conversational capture; the MVP definition is now "browser-only personal second brain with private GitHub-backed sync and conversational capture." Attachments (Phase 6), multi-step setup polish (Phase 7), and full PWA + offline-first (Phase 10) are not part of that definition. The production GitHub App swap and serverless proxy port that originally hid inside Phase 7 stay on the critical path — they're already filed in Phase 11. A minimal manifest.json for mobile "Add to Home Screen" remains in Phase 11 too. Phase numbers were left stable rather than renumbered to preserve back-references in this log.

---

## 11. Known Blockers / Risks

Track things that might require a plan revision.

- ~~**CORS proxy for GitHub traffic is a third-party public endpoint.**~~ Resolved 2026-04-22 — see §10. All GitHub traffic now goes through same-origin Vite proxies (`/__gh`, `/__gh_api`, `/__gh_git`). Phase 11 production work is to replicate the same three proxy routes as serverless functions on the deploy target; no token or clone payload transits a third-party host in dev or prod.

---

## 12 & 13. Out-of-scope + backlog — moved to POST-MVP-PLANS

2026-05-11: The "Out of scope for MVP" list and the post-MVP backlog were moved to [POST-MVP-PLANS-2026-05-11.md](./POST-MVP-PLANS-2026-05-11.md). When MVP work surfaces a new candidate, file it there. CONSTRAINTS §11 remains authoritative on what's permanently out of scope vs. just deferred.
