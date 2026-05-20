# Open Brain — MVP Implementation Plan

**Date:** 2026-04-17 (drafted) · last updated 2026-05-20
**Status:** Active plan; resume across sessions by checking boxes
**References:** [CONSTRAINTS](./CONSTRAINTS-2026-04-17.md) · [TECH-STACK](./TECH-STACK-2026-04-17.md) · [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md) · [DESIGN](./DESIGN-2026-04-17.md) · [POST-MVP-PLANS](./POST-MVP-PLANS-2026-05-11.md) · [PHASES-COMPLETED](./PHASES-COMPLETED-2026-04-17.md)

### Phase status snapshot (2026-05-20)

Shipped phases live in [PHASES-COMPLETED-2026-04-17.md](./PHASES-COMPLETED-2026-04-17.md). Working surface below.

| Phase | State | Tag |
| --- | --- | --- |
| 0 through 5.9.1 | ✅ shipped — see [PHASES-COMPLETED](./PHASES-COMPLETED-2026-04-17.md) | `phase-{0,1,…,5.9.1}-complete` |
| 5.9.2 — Conversational coherence & self-knowledge | 🟡 implementation shipped; manual replay pending | — |
| 6 — Attachments | ⛔ moved to POST-MVP | — |
| 7 — Setup polish | ⛔ moved to POST-MVP | — |
| 8 — Design pass | ✅ shipped — see [PHASES-COMPLETED](./PHASES-COMPLETED-2026-04-17.md) | `phase-8-complete` |
| 9 — Errors + a11y | ✅ shipped — see [PHASES-COMPLETED](./PHASES-COMPLETED-2026-04-17.md) | `phase-9-complete` |
| 10 — PWA & offline | ⛔ moved to POST-MVP | — |
| 10.5 — Deterministic e2e | 🔜 placeholder; not started | — |
| 10.7 — Architectural review | 🔜 placeholder; depends on 10.5 | — |
| 11 — Launch prep / Cloudflare Pages | 🟡 scaffolded; deploy steps open | — |

Test count at the last green check: **446 tests across 53 files** (post-Phase 5.9.2). `main` is at the tip of Phase 5.9.2 (commit `a1b22a5`).

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

## Phases 0 through 5.9.1 — archived

All shipped between 2026-04-17 and 2026-05-19. Each phase has a `phase-N-complete` git tag (see the snapshot table at the top of this doc for the per-phase tag). Full text — original tasks, exit criteria, deferred items, prior art — is preserved in [PHASES-COMPLETED-2026-04-17.md](./PHASES-COMPLETED-2026-04-17.md):

- **Phase 0** — Project scaffolding
- **Phase 1** — Walking skeleton
- **Phase 2** — Vault & Browse tab
- **Phase 3** — Sync engine
- **Phase 4** — Memory pipeline
- **Phase 5** — Chat & retrieval
- **Phase 5.5** — Conversational note operations
- **Phase 5.6** — Note lifecycle commands
- **Phase 5.7** — Chats as first-class memory
- **Phase 5.8** — Auto-organize and proactive connections
- **Phase 5.9** — Persona & capabilities context
- **Phase 5.9.1** — Conversation context overflow

Open the archive when you need historical context — what was tried, what was deferred, what the test count was at each tag. Otherwise, the active phases below are the working surface.

---

## Phase 5.9.2 — Conversational coherence & self-knowledge

> Planned 2026-05-19 after a real-user chat showed two failure modes that 5.9 didn't catch.
>
> 1. **Self-knowledge gap.** The user asked "How do I use your slash commands?" and the model responded "I've organized your list… (Toothbrush, Low cal treat)". The `CAPABILITIES_PROMPT` from Phase 5.9 _did_ fire, but at ~350 tokens it can only enumerate the commands, not explain them. When the user asks a specific how-do-I question the model has no anchor and confabulates from retrieval instead.
> 2. **Out-of-order / hallucinated-action responses.** Earlier in the same chat: user says "I need a toothbrush and a low cal treat from the grocery store" — model responds "Your cat is named Belle" (re-answering the _previous_ turn). And the "I've organized your list" reply above is an action the model never executed — `/organize` requires a target arg, the host returned a system message asking for one, but the _model_ later spoke as if the command had run. The most likely cause is chat-RAG (Phase 5.7) retrieving fragments of the current session — the prior slash-command line + its system confirmation — and the model treating those as ground truth about what it just did.
>
> Logged chat ([`.chats/2026-05-19_14-23-44-468.md`](../.chats)) is the test case.

### Direction

Two intertwined tracks, both small:

- **(A) Self-knowledge.** Ship an app-bundled, read-only help corpus under `.openbrain/help/` (three files: `getting-started.md`, `slash-commands.md`, `vault-layout.md`) and admit those paths to the retrieval index. Specific how-to questions then anchor against retrieved chunks instead of confabulating. Keep `CAPABILITIES_PROMPT` lean (behavioral guardrails only); long-form how-to lives in the indexed corpus where retrieval can budget it on demand. Also ship a deterministic `/help` slash command for command discovery without an LLM round-trip.
- **(B) Conversational coherence.** Suppress chat-RAG from re-surfacing chunks of the **current** chat session that the model is already seeing in its live history. Phase 5.9.1's sliding-window strategy explicitly relies on chat-RAG to recover **old** trimmed turns, so the filter has to be narrow: drop chunks whose underlying turn is still present in `working.messages`; keep chunks for turns that have aged out. If that distinction proves impractical, fall back to B2 (system-prompt anchor directive) instead.

Both tracks materialise into tasks below — picked from the open-question round on 2026-05-19.

### Why an indexed help note beats expanding `CAPABILITIES_PROMPT`

| Concern | Indexed help note | Bigger `CAPABILITIES_PROMPT` |
|---|---|---|
| Every-turn token cost | ~0 (only retrieved when relevant) | Linear — paid on every turn including small talk |
| Cache discipline | Untouched — prefix stays byte-stable | Edits bust the KV-cache prefix for everyone |
| Granularity | RAG returns the relevant section (e.g. `/organize` doc) | Whole prompt always present, model has to find the relevant clause |
| Update cadence | Bundle const → atomic with code; `CONTENT_VERSION` triggers rewrite | Same |
| Failure mode | Retrieval miss → fall back to short capabilities prompt | None — but bloat costs latency on every turn |

The cost of a retrieval miss is bounded: `CAPABILITIES_PROMPT` still ships and still names every command. The indexed doc is a depth layer, not the only layer.

### Tasks (A) — indexed help corpus + `/help` command

#### Content bundle (`src/lib/llm/help-corpus.ts` — new)

- [ ] `HELP_CORPUS_VERSION = 1`. Bumped whenever any doc's content changes; embedding sidecars carry the version so stale on-disk copies are rewritten.
- [ ] `HELP_CORPUS` — `{ path: NotePath; content: string }[]` with three entries:
  - `.openbrain/help/getting-started.md` — "What is Open Brain?", first-run flow, sync model, where notes live, what RAG does for you, when to expect the model to draw from notes vs. just chat.
  - `.openbrain/help/slash-commands.md` — one section per command in `SLASH_COMMANDS`, headed `## /command`, with: what it does, args, what shows up in the vault, an example. This is the anchor surface for "how do I X?" retrieval and for the deterministic `/help <command>` output.
  - `.openbrain/help/vault-layout.md` — `notes/`, `journal/`, `lists/`, `.chats/`, `.openbrain/`, `.memory/` — what each is for, what writes there, what reads from there.
- [ ] Target ~3–6 KB per file (one or two retrievable chunks each, depending on the chunker's window). Total bundle under 20 KB.
- [ ] Test: every command in `SLASH_COMMANDS` has a `## /<name>` heading in the slash-commands doc; every section in each doc starts with a level-2 heading (for stable chunk boundaries).

#### Whitelist through the memory pipeline

- [ ] [src/lib/memory/index.ts:194](../src/lib/memory/index.ts) — change the `.openbrain/` early-return to a more specific filter: paths matching `.openbrain/help/*.md` are admitted; everything else under `.openbrain/` (persona, config, command-stats) still short-circuits. Inline rationale comment: the help corpus is app-shipped indexable content; persona and config stay private.
- [ ] Skip the extraction queue for help docs (`if (path.startsWith('.openbrain/help/')) return;` before the `extractionQueue.enqueue` call). They're structured how-to text; the LLM extraction pass adds nothing and burns inference.
- [ ] Standard chunker handles `.openbrain/help/*.md` (path prefix is neither `.chats/` nor a journal date — it should fall through to the default branch already). Confirm in tests rather than assuming.

#### Bootstrap rewrite

- [ ] Add `ensureHelpCorpus(vault)` alongside the existing `ensurePersonaStub`: for each entry in `HELP_CORPUS`, if the file is missing OR its first-line `<!-- openbrain-help: vN -->` marker is lower than `HELP_CORPUS_VERSION`, overwrite. Otherwise leave it alone.
- [ ] Called from `bootstrapMemory()` (or wherever `ensurePersonaStub` is wired today). Runs once per mount, behind the same "signed-in + vault available" gate. Re-enqueue happens automatically through the vault-change subscription that `bootstrapMemory` already wires.

#### Browse UX — read-only banner

- [ ] Surface `.openbrain/help/` files under the existing "App settings" section from Phase 5.9 (extend `vault.listAppSettings()` to recurse one level, or add `.openbrain/help/` to its known-prefix set).
- [ ] Add a read-only banner above the editor for any file under `.openbrain/help/`: _"This file is shipped with Open Brain and rewritten on update. Edit `.openbrain/persona.md` for your own notes."_ Mirrors the existing Phase 5.7 chat read-only banner pattern.
- [ ] Editor's save button stays enabled — bootstrap rewrites on next reload. Banner copy documents the clobber behavior.

#### Retrieval pipeline check

- [ ] Confirm that `assembleContext` doesn't filter `.openbrain/` paths out of its candidate set. If it does, lift the filter for `.openbrain/help/*.md` specifically.
- [ ] Manual: ask "how do I save a journal entry?" — answer cites a `.openbrain/help/` path and describes `/journal`. Exit criterion below.

#### `/help` slash command (`src/lib/chat/slash-commands.ts` or sibling)

- [ ] Register `/help` (no-arg) and `/help <command>` in the parser/dispatch alongside the existing commands.
- [ ] No LLM call. No-arg form returns a deterministic system message listing every command + one-line description (sourced from a `SLASH_COMMAND_SHORTHELP` map kept next to `SLASH_COMMANDS`), plus a closing line like _"Run `/help <command>` for details, or ask in plain English."_
- [ ] `/help <command>` returns the corresponding `## /<command>` section of `slash-commands.md`, located by string-matching the heading (so the help corpus stays the single source of truth for command descriptions). Unknown command → error system message listing valid commands.
- [ ] Tests: parser recognises both forms; no-arg returns a string covering every `SLASH_COMMANDS` entry; per-command form returns the right section; unknown-command form errors cleanly.
- [ ] Add `/help` to `SLASH_COMMANDS`. The slash-commands.md doc covers it like any other command — including a meta entry explaining that `/help` itself is deterministic and never calls the model.

#### `CAPABILITIES_PROMPT` trim

- [ ] Remove the per-command one-line list from `CAPABILITIES_PROMPT` (lines 31–32 of [src/lib/llm/capabilities.ts](../src/lib/llm/capabilities.ts)) — leave just the names, no descriptions, plus a new line: _"For details on any command, the user can run `/help <command>` or ask in plain English; the help corpus at `.openbrain/help/` is retrievable."_ Saves ~80 tokens net and lets the model know retrieval will carry depth on demand.
- [ ] Bump `CAPABILITIES_VERSION` to 2. Re-tighten the char cap to ~1100 chars.

### Tasks (B) — conversational coherence

Primary approach: **B1 (narrow self-retrieval filter)**, with fallback to **B2 (anchor directive)** if B1 can't preserve Phase 5.9.1's old-turn recall.

#### B1 — narrow self-retrieval filter (preferred)

**Chunker pre-check (2026-05-19):** [src/lib/memory/chat-chunker.ts:34-38](../src/lib/memory/chat-chunker.ts) already tags each chunk with `messageIndex: number` and `messageTimestamp: number`. No schema retrofit — B1 is purely additive plumbing.

**Trim/retrieve ordering pre-check (2026-05-19):** [src/routes/chat/+page.svelte:394-430](../src/routes/chat/+page.svelte) currently does `retrieve(...)` → `trimHistoryToBudget(...)`. B1 needs the post-trim set of "messages the model will actually see in plain history" to know which chunks are safely droppable without violating Phase 5.9.1's recall invariant. Two compatible wirings (pick one at implementation time):

- **Option B1a — post-filter retrieval after trim.** Keep the existing call order, then drop chunks from `retrieval.noteRefs` / `assembled.context` whose `(sourcePath, messageIndex)` matches a message in `trimResult.trimmed`. Lower surface area; doesn't touch retrieval signatures. Risk: `assembleContext` has already built the system prompt string by then — filter would have to apply earlier in the pipeline or rebuild the assembled string. Probably means moving filter inside `retrieve`/`assembleContext` after all.
- **Option B1b — reorder trim before retrieve.** Compute `trimResult` first (cheap; uses `approxTokens` on raw text), then pass the surviving `messageIndex` set into `retrieve(...)` as a new option. Reordering looks small but Phase 5.9.1's budget composition has retrieval depending on history-tokens-actually-used; touching the order means re-deriving the retrieval budget. Cleaner long-term, larger blast radius.

Recommend B1a unless B1b's ordering ends up tidier in practice. Both end at the same place: a `RetrievalFilter = { chatPath, liveMessageIndices: Set<number> }` carrier, applied wherever it sits best.

- [ ] Add `RetrievalFilter` type to the retrieval signature (location decided by B1a vs B1b pick).
- [ ] Filter logic: drop a chunk from `.chats/<id>.md` only when `id === filter.chatPath`'s id **and** `chunk.messageIndex` is in `filter.liveMessageIndices`. Chunks from the same session whose turns have aged out of `working.messages` via the Phase 5.9.1 sliding window pass through — that's the whole point of indexing chat sessions.
- [ ] Compute `liveMessageIndices` from `trimResult.trimmed` by mapping each kept message back to its index in `working.messages` (1:1 because chat sessions are append-only and indices are stable).
- [ ] Wire `RetrievalFilter` from the chat-page's `streamChat` call. Slash-handler LLM calls (`/edit`, `/organize`) pass `undefined` — they have no current-session concept.
- [ ] Tests: 5+ covering: chunk from current session + live messageIndex → dropped; chunk from current session + aged-out messageIndex → kept; chunk from different session → kept; chunk from `notes/` → kept; no filter provided → all chunks kept.

#### B2 — anchor directive (fallback or addendum)

- [ ] If B1 can't be done cleanly in this phase, add a single directive to `CAPABILITIES_PROMPT`: _"Answer the user's MOST RECENT message only. Earlier turns above are context. If retrieved notes reference past slash commands or system confirmations, those have already been handled by the host — do not narrate them as if you ran them."_
- [ ] Even if B1 lands cleanly, evaluate whether B2 still adds value on the smallest model variant (Llama-3.2-1B is most prone to the misframing). Cheap to keep both; decide based on a manual replay of the 2026-05-19 chat.
- [ ] Bump `CAPABILITIES_VERSION` if added; recheck char cap.

#### B3 — lexical anchor on the current user turn (considered, not selected)

Prepending the assembled `userPrompt` with a stable `"## Question to answer\n\n<user text>"` header was on the table during planning. **Not shipped in 5.9.2** because B1 + B2 together cover the same failure modes more directly (B1 removes the confabulation source; B2 frames the model's response orientation), and B3 alters the user-prompt format in a way that may interact awkwardly with the WebLLM chat template — it would need its own validation pass against each variant.

Keep in mind for follow-up: if the 2026-05-19 replay still shows out-of-order responses after B1 + B2 ship, B3 is the next-cheapest lever to try. The reasoning is logged here so we don't re-derive it.

#### Verification

- [ ] Manual: replay the 2026-05-19 chat ([`.chats/2026-05-19_14-23-44-468.md`](../.chats)) — "I need a toothbrush and a low cal treat" no longer triggers a cat answer; "How do I use your slash commands?" no longer claims `/organize` ran; "what did we talk about earlier?" still retrieves trimmed-out turns from the same session (Phase 5.9.1 invariant).

### Token-budget impact

| Slot | Before 5.9.2 | After 5.9.2 | Notes |
| --- | --- | --- | --- |
| `CAPABILITIES_PROMPT` | ~350 tok | ~270 tok | Per-command descriptions removed; one line added pointing the model at `/help` + the retrievable help corpus. |
| Help corpus in retrieval | n/a | 0–~600 tok (variable) | Only present when retrieval surfaces it. Counts against the existing 50% retrieval slot from Phase 5.9.1 — no new budget. |
| Anchor directive (B2) | n/a | ~30 tok if shipped | Inside `CAPABILITIES_PROMPT` cap. |
| `/help` command output | n/a | 0 tok in LLM prompt | Deterministic system message; never enters a chat-completion call. |

Net effect: roughly flat on the small-talk path (smaller capabilities, no retrieval); modestly higher on a how-do-I-X path where the help corpus is retrieved — which is exactly when we want it.

### Exit criteria

- [ ] `HELP_CORPUS` ships with three files (`getting-started.md`, `slash-commands.md`, `vault-layout.md`); the lint test for command/heading parity in `slash-commands.md` is green.
- [ ] `bootstrapMemory()` (or sibling) writes `.openbrain/help/*.md` on first run and on `HELP_CORPUS_VERSION` bumps; embedding queue picks them up.
- [ ] `notifyMemoryOfChange` admits `.openbrain/help/*.md` through the `.openbrain/` filter (extraction queue still skipped); persona and other `.openbrain/` files stay private.
- [ ] Browse shows a read-only banner on `.openbrain/help/*.md`.
- [ ] `CAPABILITIES_PROMPT` trimmed; `CAPABILITIES_VERSION` bumped; char-cap test re-tightened.
- [ ] `/help` and `/help <command>` ship as deterministic (no-LLM) slash commands; added to `SLASH_COMMANDS`; tests cover both forms and the unknown-command path.
- [ ] B1 self-retrieval filter ships (chunks from the current session whose turns are still in the live history are dropped from retrieval; older trimmed turns from the same session remain retrievable). Or — if B1 can't preserve the Phase 5.9.1 recall invariant — B2 ships instead, with the reason documented.
- [ ] Manual: ask "how do I save a journal entry?" — answer cites a `.openbrain/help/` path and describes `/journal`.
- [ ] Manual: ask "How do I use your slash commands?" — answer comes from retrieved help corpus, not from a hallucinated `/organize` run.
- [ ] Manual: replay 2026-05-19 chat — "I need a toothbrush and a low cal treat" no longer triggers a cat answer; "what did we talk about earlier?" still recalls trimmed turns from the same session (Phase 5.9.1 invariant intact).
- [ ] `npm run check` green.
- [ ] Tag `phase-5.9.2-complete`.

---

## Phases 6 & 7 — moved to POST-MVP-PLANS

2026-05-11: Phase 6 (Attachments) and Phase 7 (First-run setup polish + compat detection) were moved to [POST-MVP-PLANS-2026-05-11.md](./POST-MVP-PLANS-2026-05-11.md). The MVP critical path runs Phase 5.6 → Phase 8 directly. The production GitHub App swap and serverless proxy port from the old Phase 7 stay on the MVP critical path — they live in Phase 11.

---

## Phases 8 & 9 — archived

Both shipped 2026-05-11 (subsets; remaining items either deferred to POST-MVP or filed inside [Phase 10.5](#phase-105--deterministic-e2e-test-suite)). Tagged `phase-8-complete` and `phase-9-complete`. Full task lists and exit criteria are preserved in [PHASES-COMPLETED-2026-04-17.md](./PHASES-COMPLETED-2026-04-17.md).

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
