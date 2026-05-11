# Open Brain — Post-MVP Plans

**Date:** 2026-05-11
**Status:** Holding pen for work explicitly deferred past MVP launch.
**Cross-refs:** [IMPLEMENTATION-PLAN](./IMPLEMENTATION-PLAN-2026-04-17.md) · [CONSTRAINTS](./CONSTRAINTS-2026-04-17.md) · [ARCHITECTURE](./ARCHITECTURE-2026-04-17.md) · [DESIGN](./DESIGN-2026-04-17.md)

---

## Purpose

The MVP plan got crowded as Phases 5.5 and 5.6 reshaped the product around conversational capture. Phases 6, 7, and 10 (attachments, multi-step setup polish, PWA & offline) survived the original plan but no longer block the MVP definition: "a personal second brain, in a browser, with private GitHub-backed sync and conversational capture."

This doc is the holding pen. Anything here:

- Is **not committed** for the MVP launch.
- Is **candidate for prioritization** after the launch retro.
- Should be **moved back into the implementation plan** (with a new phase number) when it's promoted.

Order within each section is not priority — it's just inherited from where the item lived before.

---

## Deferred phases (moved out of the implementation plan)

### Attachments (was Phase 6)

Drag-drop images and files into notes, with same-vault storage.

- [ ] `AttachmentStore` interface per architecture §6
- [ ] `GitHubRepoAttachments` impl: reads/writes under `attachments/`
- [ ] Drag-and-drop on the editor → stores blob → inserts Markdown image/link
- [ ] Attachments sync as part of the normal commit flow
- [ ] Attaching from any tab works; the file ends up in `attachments/` and renders when referenced

**Why post-MVP:** The capture loop (chat → journal/notes/lists) is the load-bearing experience. Photos and files are an enhancement to that loop, not part of its definition. Ship the core; attach later.

**Coexistence note:** When this comes back, attachments need to flow through proposal cards too — a drag-drop image should propose "add image to today's journal" rather than write directly. Phase 5.5's proposal-card pipeline is the seam.

---

### First-run setup polish (was Phase 7)

A multi-step setup flow with compatibility detection.

#### Compat detection (`src/lib/compat/`)
- [ ] Detect WebGPU, Web Speech API, IndexedDB/OPFS availability, rough VRAM
- [ ] `getCapabilities()` returns a typed struct

#### Setup flow polish
- [ ] `/setup` becomes a multi-step flow:
    1. Compatibility matrix (✅/⚠️/❌ per feature on current browser)
    2. Sign in with GitHub
    3. Pick existing private repo OR create new one (`gh`-style name input)
    4. First clone (progress)
    5. Pick Gemma variant (skip if no WebGPU; user can use the app without Chat)
    6. Initial model download
    7. "You're set up" → redirect to `/chat`
- [ ] If auth/repo already set, `/` redirects straight to `/chat`

#### Browser compatibility page
- [ ] Standalone `/compat` route with the full matrix + guidance for each browser
- [ ] Linked from error states when a feature is unavailable

**Why post-MVP:** A working `/setup` already exists (sign-in + repo picker + clone + model load). What was in Phase 7 is the multi-step polish and the standalone compat page. The production GitHub App swap and serverless proxy port live in Phase 11 launch prep — those stay on the MVP critical path.

---

### PWA & offline (was Phase 10)

Full PWA install + offline-first experience.

- [ ] Install `@vite-pwa/sveltekit`; configure manifest (name, icons, theme color, standalone)
- [ ] App shell precached via Workbox
- [ ] All routes render offline (compat page shows clear "offline" state when GitHub is unreachable)
- [ ] Lighthouse PWA audit passes
- [ ] Test: airplane mode → app still loads → Chat works → Browse works → sync queues changes → come back online → sync flushes
- [ ] App installs as PWA on mobile and desktop; offline-first experience feels seamless

**Why post-MVP:** The product vision is "just visit a URL — no installs." PWA install is a nice optional path but is not the experience we're promising. Offline-mode is genuinely useful but adds caching surface area (service worker, asset hashing, IndexedDB+OPFS race conditions) that's not worth gating launch on. Ship as a web app; layer PWA on once we have real users.

**Carve-out for MVP:** A minimal `manifest.json` for "Add to Home Screen" on mobile is small and ships in Phase 11. The full Workbox + offline test matrix is what's deferred here.

---

## Explicitly out of scope for MVP

Restated from [CONSTRAINTS §11](./CONSTRAINTS-2026-04-17.md) so this doc is self-contained:

- Real-time collaboration
- Server-side AI
- Non-GitHub auth
- Native mobile apps
- Plugin system
- Rich markdown rendering
- Voice output (TTS) — _partially shipped in Phase 5.5; full conversational voice mode is below_
- AAAK / lossy compression
- User-selectable embedding model
- External attachment storage (Dropbox, S3)

---

## Deferred enhancements (the backlog)

Filed during MVP work so ideas don't get lost. Unordered.

### Sync & conflict resolution

- [ ] **Tier 3 conflict auto-recovery.** Write `<path>.conflict-<ISO>.md` backup, reset workdir to remote, replay. Deferred from Phase 3 because the destructive reset/replay needs browser-level testing on a real `MergeNotSupportedError`. See IMPLEMENTATION-PLAN §10 2026-05-05 Phase 3 entry.
- [ ] **Tier 2 produces true merge commits.** Today resolution lands as a single-parent commit (HEAD only); the push-rejection auto-recovery loop converges but may produce more conflict iterations than necessary. Detect `MERGE_HEAD` post-resolution and pass `parent: [...]` to `commit()`. See IMPLEMENTATION-PLAN §10 2026-05-09 #9.

### Auth & security

- [ ] WebAuthn-encrypted token storage

### Memory pipeline & retrieval

- [ ] **Background organize queue.** Add an `'organize'` job kind to the extraction queue so suggestion sidecars get auto-generated for "messy" notes (daily journals, inbox dumps) as content changes, instead of only when the user types `/organize`. Lower priority than embedding jobs; respects `GpuLease`. _Deferred from Phase 5.5. Today the on-demand `/organize @path` covers the user value; auto-triggering is polish but increasingly load-bearing if conversational capture lands._
- [ ] **AAAK render-at-retrieval experiment.** Only if vault size demands.

### Browse & editor

- [ ] **Browse Organize panel.** When a note with a suggestion sidecar is opened in `/browse`, render an "Organize" panel listing each suggestion as an accept/reject chip. Accept produces a proposal card via the existing pipeline. _Deferred from Phase 5.5. Today suggestions surface only via `/organize` in chat._
- [ ] **Rich markdown preview**
- [ ] **Graph view / backlinks panel**

### Chat & conversational ops

- [ ] **Proposal card edit-then-apply + discarded-proposal markers.** Card today has Apply / Discard. An Edit affordance that reopens the diff in the chat input as editable text, and persisting discarded proposal IDs as `<!-- discarded:proposal-id -->` markers in the chat-session markdown so the LLM doesn't re-propose the same thing. _Deferred from Phase 5.5._
- [ ] **`@`-mention title + alias matching.** V1 ships path-only. Building a richer `MentionIndex` that reads each note's frontmatter (title, aliases) at vault-change time would let users type `@grocery` and match `lists/grocery-list.md` by alias. _Deferred from Phase 5.5 until measured miss rates justify the per-file frontmatter read cost._
- [ ] **Embedding-suggester accuracy measurement.** Curate ~30 representative phrasings, measure top-1 promotion accuracy, tune threshold (currently 0.55). _Deferred from Phase 5.5._
- [ ] **Chip bar mobile `visualViewport` pinning + desktop hover-reveal collapse.** Today the bar uses natural flexbox layout (works on mobile; always visible on desktop). Explicit `visualViewport.offsetTop + height` pinning and a desktop hover-reveal would polish both surfaces. _Deferred from Phase 5.5._
- [ ] **Archived-note filtering in retrieval.** Today `/archive` stamps `archived_at:` but chat retrieval still surfaces archived notes. _Deferred from Phase 5.6._

### Design + a11y polish (deferred from Phases 8 & 9, 2026-05-11)

- [ ] **Theme switcher UI** (System / Light / Dark) wired to `[data-theme]` and persisted to `.openbrain/config.json` so the choice syncs across devices. The CSS infrastructure already exists.
- [ ] **Scan-line overlay** for model-download + initial-clone screens (design §7 / §11). Optional flourish; disabled by default in light mode; togglable off entirely.
- [ ] **Command palette** (`Cmd/Ctrl+K`) — terminal-feel quick-jump. Stub-OK MVP: open notes by name. Overlaps with Phase 5.6 `/find`.
- [ ] **Self-host Inter + JetBrains Mono** with explicit `font-feature-settings`. Today's stack falls back through system UI fonts cleanly.
- [ ] **GitHub rate-limit status-bar countdown.** Parse `X-RateLimit-Reset`; show `◇ rate-limited, resuming in 34s` per design §9.
- [ ] **`?debug=1` debug panel** showing recent `logError` entries. The structured-logging helper is already in place; this exposes it to users without devtools.
- [ ] **Contrast + axe + Lighthouse a11y audits**. Run after the launch deploy lands the final color set and the production font stack. Target: AAA body, AA everywhere; Lighthouse ≥ 95.
- [ ] **Zoom-to-200% layout verification.** Add to launch smoke checklist.

### Voice

- [ ] **Whisper transcription as a privacy/accuracy mode.**
- [ ] **Full conversational voice mode.** Continuous listening (re-arm mic after each AI turn), voice-activity detection / end-of-turn detection, interrupt handling (abort TTS + LLM stream when user speaks over the AI), and prompt tuning so responses are short enough for voice. Phase 5.5 ships the basic TTS toggle for one-shot speak-the-reply; this is the deeper "talk to it like a person" mode. Estimate: 2–3 days minimum, plus ongoing tuning since users will benchmark against ChatGPT Voice / Siri.

### Storage & ecosystem

- [ ] **External attachment storage** via `AttachmentStore` abstraction (Dropbox, S3)
- [ ] **Plugin system**

---

## Review cadence

Re-read this doc at every phase boundary in IMPLEMENTATION-PLAN, and at the launch retro. Items get promoted out of here in three ways:

1. **Pulled into the active plan** as a new phase or sub-phase (with a real exit criteria block).
2. **Closed unbuilt** because the use case evaporated. Move to a closed section at the bottom of this doc with a one-line "closed because…".
3. **Re-scoped** to a leaner version when a smaller delta would satisfy the goal.
