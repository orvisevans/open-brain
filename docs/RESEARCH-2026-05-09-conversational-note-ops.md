# Research — Conversational Note Operations (2026-05-09)

**Author:** research pass for Phase 5.5 scoping
**Status:** Findings + opinionated recommendation. Not a plan.
**Scope:** How shipped second-brain products let users *create, edit, append, organize, recall* notes via chat — and which patterns survive the constraint of running a 2–4B local model in the browser with shaky tool-calling.

---

## 1. TL;DR

- **Frontier-hosted products (Mem 2.0, Capacities, Tana, Reflect) lean on tool/function calling and "magic" intent classification.** That posture is not portable to WebLLM + Gemma-1B/4B; we will get hallucinated targets and silent data loss if we copy it directly.
- **The pattern that ports cleanly is "AI proposes, human commits."** NotebookLM (explicit `Save to note`), Smart Composer (one-click apply), Heptabase (drag chat message onto whiteboard), Khoj (yellow-highlight previewed edits) all converge here. It tolerates a much weaker model because the human is the final classifier.
- **Slash commands beat free-form intent classification on small models.** `/append`, `/save`, `/journal`, `/grocery` keeps the LLM out of the routing decision entirely. Notion, Khoj, Logseq Copilot all use this. Do this for the 80% case; reserve LLM intent only for natural-language fallback.
- **A "daily note" inbox is the right default destination.** Reflect, Logseq, Tana, Capacities, Saner all funnel ambiguous capture into a daily journal first, then organize asynchronously. This sidesteps the hard "where does this go?" problem until a human (or a stronger model) can resolve it later.
- **Small structured schemas (frontmatter properties) beat ad-hoc tagging.** Tana's supertags, Capacities' object types, Notion's databases — all give the model a closed vocabulary to fill in. We already have YAML frontmatter; lean into it.
- **Append-to-list ("add eggs to grocery") works *only* if list discovery is deterministic.** Use a vault convention (`type: list` frontmatter, or `lists/` folder), not LLM search. Otherwise the model picks the wrong target and silently corrupts a note.
- **"Save this chat as a note" is the highest-leverage, lowest-risk first feature.** No retrieval, no destination ambiguity, no edit conflicts; just a transform + write. Ship it first to validate the UX shell.
- **Reor is our nearest neighbor and it deliberately *doesn't* do conversational write ops** — its AI is read-only Q&A + auto-link. That's a signal that on small local models, write ops are still an unsolved UX problem, not just an unimplemented one.

---

## 2. Use-case taxonomy

The user's wishlist clusters into five operations. Each has different difficulty under our constraints.

**Capture (new note from chat).** "Save this chat as a note." "I met X — they're interesting because Y." Easy: the destination is either explicit (`save as`) or a sensible default (today's daily note, or a new `people/x.md`). The LLM's job is to *format*, not to *route*. Lowest risk.

**Append (add to existing note).** "Add eggs to grocery list." "Add this to the gift ideas note." Hard: requires finding the right target note, then editing it without clobbering. Disambiguation is the failure mode — small models will confidently pick the wrong note. Mitigated by vault conventions (named lists, frontmatter type) so retrieval can be deterministic instead of semantic.

**Edit (modify existing content).** "Rename the section heading." "Replace 'Tuesday' with 'Wednesday' in last week's journal." Hardest. Requires the model to produce a precise diff and the user to verify it. Khoj and Smart Composer both implement this with a preview/diff pattern; nobody trusts the model to commit unilaterally.

**Organize (tag, link, move, structure).** "Tag last week's journal entries with #travel." "Link this to my partner's note." Mostly background work; can be deferred to the existing memory pipeline. Conversational entry point should suggest tags/links and let the user accept, not auto-apply.

**Recall (retrieve, summarize, list).** "What gift ideas do I have for my partner?" "Summarize my journal from last week." Already shipped in Phase 5 via RAG. The 5.5 work is making the *answers* operable — e.g. "save that as a note" turns recall into capture.

Schedule/reminders is a sixth bucket the user mentioned. We have no notification surface (browser-only, no push reliably). Out of scope for 5.5 unless we resolve to "render reminders as a sorted list under `reminders.md` and let the user check it." Calling it out as an open question, not a target.

---

## 3. System-by-system analysis

### Mem.ai (Mem Chat / Mem 2.0)

One-line: hosted note app where chat is the primary surface; AI auto-organizes.

How it works: natural-language chat with no special syntax, plus `@Note` and `#Collection` mentions for explicit context selection ([help.mem.ai/features/chat](https://help.mem.ai/features/chat)). Mem claims chat can "create, edit, organize" via plain language. Destination decisions are made by the model + Mem's internal organizer; user does not pick paths.

- **Pros:** validates that "no slash commands, just talk" *is* viable — *if* you have a frontier model and a closed-source organizer behind it.
- **Cons:** Closed source; "no special commands" requires high-quality intent classification we don't have. Mem also famously over-organizes — users can't predict where a note went. That failure mode is much worse for us because our UX promise is local-first / vault transparency.
- **Verdict:** inspiration only. Steal the `@`/`#` mention syntax for explicit context; don't try to replicate the magic.

### Reflect (Reflect AI)

One-line: minimalist daily-notes app with chat-with-notes powered by GPT-4o / Claude 3.5 ([reflect.app/blog/chat-with-your-notes](https://reflect.app/blog/chat-with-your-notes)).

How it works: chat is read-mostly. Voice transcription (Whisper) drops content into the daily note by default. AI features lean toward writing assistance inline rather than chat-driven CRUD.

- **Pros:** "everything goes to today's daily note unless told otherwise" is a strong default we should adopt.
- **Cons:** the heavy AI features (cleanup, structure) all assume hosted frontier models.
- **Verdict:** partially adopt — daily-note default destination, voice → daily note pipeline.

### Tana (supertags + AI nodes + voice chat)

One-line: outliner where every node can be tagged with a *supertag* that defines a schema (fields), and AI commands operate over that structure ([tana.inc/docs/ai-command-nodes](https://tana.inc/docs/ai-command-nodes), [outliner.tana.inc/articles/talk-through-your-ideas-with-tana-ai-voice-chat-for-ios](https://outliner.tana.inc/articles/talk-through-your-ideas-with-tana-ai-voice-chat-for-ios)).

How it works: voice chat is "informed by the fields for structured conversations" — when you tag a thought as `#person`, the AI knows the schema (name, met-at, why-interesting) and fills in fields. AI commands are first-class nodes you can configure.

- **Pros:** the structured-schema-per-type idea is exactly what the user's "I met X" use case needs. Closed vocabulary → small model is much more likely to succeed at filling fields than at free-form classification.
- **Cons:** Tana's outliner data model is alien to a markdown vault; we'd be importing the *idea* (typed objects with fields), not the implementation. Cloud-hosted; uses frontier models.
- **Verdict:** adopt the pattern. `type: person` / `type: list` / `type: gift-idea` in frontmatter, with a small known set, gives our local model a tractable filling problem.

### Logseq Copilot / Logseq AI plugins

One-line: third-party plugins that bolt ChatGPT onto Logseq blocks ([github.com/chhabrakadabra/logseq-plugin-copilot](https://github.com/chhabrakadabra/logseq-plugin-copilot)).

How it works: keyboard shortcut opens chat dialog; user can "easily insert note suggestions into Logseq" — i.e. AI proposes a block, user clicks insert. There is no autonomous write.

- **Pros:** confirms the manual-insert pattern is acceptable to power users. Keyboard shortcut + insert button is cheap and works.
- **Cons:** thin integration; doesn't really teach us about routing.
- **Verdict:** inspiration only.

### Obsidian: Smart Composer

One-line: Cursor-style AI editing for an Obsidian vault ([github.com/glowingjade/obsidian-smart-composer](https://github.com/glowingjade/obsidian-smart-composer)).

How it works: chat with `@filename` / `@folder` for explicit context; AI proposes edits to the active document; user clicks **Apply** to commit. Local model support exists. Vault Search (RAG) auto-includes relevant notes.

- **Pros:** the closest mainstream analog to what we want. The `@`-mention + apply-button UX is well-validated. Open source, so we can read the code.
- **Cons:** assumes a *currently open* document as the edit target. Our "add eggs to grocery" use case has no open document.
- **Verdict:** adopt — the `@` mention syntax and the explicit Apply button are core patterns for us.

### Obsidian: Smart Connections

One-line: long-running RAG plugin with a "Smart Chat" panel.

How it works: chat panel that retrieves over the vault. Writes happen via copy-paste or "insert" buttons, not autonomously.

- **Verdict:** skip — its retrieval is similar to ours, and it doesn't push the write UX further than Smart Composer does.

### Khoj

One-line: open-source self-hosted second brain with local-LLM support, with a Cursor/Canvas-inspired editing system ([docs.khoj.dev/features/chat](https://docs.khoj.dev/features/chat), [github.com/khoj-ai/khoj](https://github.com/khoj-ai/khoj)).

How it works: explicit slash-commands (`/default`, `/online`, `/image`, `/code`, `/diagram`). Editing uses a JSON-based modification system that previews changes in **yellow highlighting** before application. Supports Ollama for local models.

- **Pros:** This is the most directly applicable system in the survey. Slash commands are an explicit, deterministic intent surface (perfect for small models). The yellow-highlight preview is exactly the "AI proposes, human commits" UX. They've already done the work of figuring out what JSON shapes a small local model can reliably produce.
- **Cons:** requires a server backend; their slash command set is geared at general assistant use, not CRUD-on-notes. Not browser-only.
- **Verdict:** **adopt heavily.** Slash command surface + diff-preview + apply pattern is the spine of our 5.5.

### Reor

One-line: Electron desktop app, local LLM (Ollama), local embeddings (Transformers.js), local vector DB (LanceDB), markdown vault — basically open-brain's twin ([github.com/reorproject/reor](https://github.com/reorproject/reor)).

How it works: AI features are deliberately scoped to **read-only Q&A + automatic backlinks via vector similarity**. The "chat" is RAG over the corpus. Writing is a manual editor; AI does not mutate notes.

- **Pros:** strongest signal in the survey. The team closest to our constraints chose *not* to ship conversational write ops. Suggests the product cost (model unreliability → user trust collapse) outweighed the feature value.
- **Cons:** they're on Ollama (any model size); we're on WebLLM (1B–4B). Our model is even weaker than theirs, so their conservatism is a *floor*, not a ceiling, for ours.
- **Verdict:** sobering — adopt their conservatism. Start with the safest write ops (save chat as note, append-to-explicit-target) and grow from there.

### Notion AI

One-line: hosted, frontier model, slash-command + inline-action surface ([notion.com/help/guides/using-slash-commands](https://www.notion.com/help/guides/using-slash-commands)).

How it works: `/ai` opens the AI menu; on any block, inline actions (Improve writing, Proofread, Explain) operate locally. Chat panel exists for cross-page work.

- **Pros:** the best-known slash-command-driven AI UX. Validates the pattern at scale. Inline actions on a selection are a clean way to scope an edit.
- **Cons:** Notion's data model (blocks in databases) makes their structured AI work; ours is markdown files.
- **Verdict:** adopt the slash-command surface; adopt the "inline action on a selection" interaction for the editor.

### NotebookLM

One-line: Google's source-grounded chat-with-documents ([support.google.com/notebooklm/answer/16179559](https://support.google.com/notebooklm/answer/16179559)).

How it works: Chat outputs are *not* saved unless the user explicitly clicks **Save to note** on a response. Saved notes become first-class objects in the notebook and feed back into context.

- **Pros:** the cleanest implementation of "save this chat as a note" — and the user explicitly asked for that. Worth copying nearly verbatim.
- **Cons:** notebook scope is narrower than ours (sources are picked per-notebook); doesn't help with append/edit.
- **Verdict:** adopt — this is the model for our `Save as note` button on chat messages and on whole sessions.

### Heptabase

One-line: visual whiteboard PKM with AI chat that produces draggable cards ([wiki.heptabase.com/work-with-ai](https://wiki.heptabase.com/work-with-ai)).

How it works: AI responses are objects; the user *drags* a chat message onto a whiteboard to commit it as a card. Hover-on-card AI actions create *new* cards rather than mutating the source.

- **Pros:** great instinct that **AI output should always materialize as a new artifact, never silently mutate an existing one.** Reduces edit/conflict risk to zero.
- **Cons:** UX requires a canvas; we have a tab/list UI. The principle ports though.
- **Verdict:** adopt the principle — when in doubt, AI creates a new note rather than editing an existing one.

### Capacities

One-line: object-typed PKM with per-message `@` context, MCP connectors, and Save-as-object on chats ([docs.capacities.io/reference/ai-assistant](https://docs.capacities.io/reference/ai-assistant)).

How it works: typed objects (Person, Project, Idea…) with properties; AI can auto-fill properties; chat messages can be saved as a `chat object`; per-message `@` context selection.

- **Pros:** confirms two patterns we want — typed objects with auto-fillable properties, and chats-as-saveable-objects.
- **Cons:** closed source, hosted models.
- **Verdict:** partially adopt (typed objects, chat-as-savable).

### Saner.ai

One-line: ADHD-targeted inbox-first capture; auto-tags incoming items.

How it works: everything lands in a single inbox; AI suggests tags/category/destination; user accepts. The AI never decides destination unilaterally.

- **Verdict:** partially adopt — the inbox-funnel pattern is a safe default for ambiguous capture.

### Voicenotes / Voicenotes.com

One-line: voice-first transcription app with auto-summary and auto-tags.

How it works: every recording becomes a note; AI generates summary + action items + tags as side products, not as edits to other notes.

- **Verdict:** inspiration only. Reinforces "AI output as new artifact, not mutation."

### mymind, Bear, Twos

- **mymind:** intentionally hides organization from the user (anti-tag stance). Not a fit — we promise transparent files.
- **Bear:** no notable conversational AI features as of public docs.
- **Twos:** list-centric capture but no real conversational AI write ops.
- **Verdict:** skip all three for this analysis.

### AnythingLLM, Quivr, PrivateGPT

One-line: self-hosted RAG-over-docs platforms.

- **Verdict:** skip — these are read-side document chat, not conversational note ops on a writable vault.

### LangChain / LlamaIndex agent patterns

- **Verdict:** reference only. The "ReAct + tool calling" pattern is the canonical implementation, but it presumes reliable tool calling, which we don't have. Useful as a vocabulary, not a blueprint.

---

## 4. Cross-cutting design patterns

### 4a. Slash-command intent surface

**What:** typed prefix like `/save`, `/journal`, `/append`, `/grocery` switches the chat into a deterministic mode. **Who:** Notion AI, Khoj, Logseq Copilot, Slack/Discord — every chat product with non-trivial actions. **Why it works on small models:** it removes intent classification from the LLM entirely. The model only has to fill a known structure for a known operation. Strongly recommended.

### 4b. `@`-mention for explicit targeting

**What:** `@notename` in the chat message picks the operation target or context. **Who:** Mem, Smart Composer, Capacities, Heptabase. **Why:** moves disambiguation from the model to the user. With path autocomplete, it's the single most reliable way to avoid wrong-target writes on a small model.

### 4c. AI proposes, human commits (preview + apply)

**What:** the model emits a proposed edit/note; the UI shows a diff or preview; the user clicks **Apply**, **Edit**, or **Discard**. **Who:** Khoj (yellow highlighting), Smart Composer (one-click apply), NotebookLM (Save to note), Heptabase (drag to whiteboard), every AI commit-message tool. **Why:** the human is the final classifier, so model accuracy can be 70% and the system still feels reliable. **This is the single most important pattern in the survey for our use case.**

### 4d. Daily-note as default inbox

**What:** ambiguous capture lands in today's daily note rather than trying to find a "right" home. **Who:** Reflect, Logseq, Tana, Saner, Roam (predecessor). **Why:** the destination problem becomes trivial; the organize step is a separate, deferrable concern. We already have a vault — we just need to define the daily-note path.

### 4e. Typed objects with closed-vocabulary properties

**What:** a small set of types (`person`, `list`, `journal`, `idea`, `gift-idea`) declared in YAML frontmatter, each with known fields. **Who:** Tana (supertags), Capacities (object types), Notion (databases). **Why on small models:** filling a known schema is much easier than free-form generation. Field count and type guidance dramatically reduces hallucination. Pairs with our existing frontmatter convention.

### 4f. AI output as new artifact, not mutation

**What:** when in doubt, the AI's response materializes as a new note/card rather than overwriting an existing one. **Who:** Heptabase explicitly; Voicenotes implicitly. **Why:** edits are unrecoverable in chat; new artifacts are safe. Combined with the daily-note default, this means our risky operations (rename, delete) can be deferred to a later phase or routed through the same preview/apply gate.

### 4g. Natural-language tool calling > JSON tool calling on small models

**What:** instead of asking the model to emit `{"tool": "append", "path": "...", "content": "..."}`, ask it to emit a fenced block in a tagged markdown shape and parse it ourselves. **Who:** Khoj (their JSON system is for larger models; their fallback is friendlier shapes); also recent literature ([arxiv.org/html/2510.14453v1](https://arxiv.org/html/2510.14453v1)) reports +18.4 pp tool-call accuracy moving from JSON to natural language, and JSON-mode hurt GSM8K by 27.3 pp ([labelyourdata.com](https://labelyourdata.com/articles/machine-learning/intent-classification)). **Why:** Gemma-1B/4B will produce broken JSON often; markdown-fenced or XML-tagged shapes are far more robust to parse.

### 4h. Sidecar properties block

**What:** structured fields stored in YAML frontmatter (or a sidecar file) so the AI has a stable, parseable surface to read/write. **Who:** Obsidian properties, Tana fields, Capacities properties. **Why:** small models reliably read key:value pairs; we already use frontmatter for sync metadata, so extending it is cheap.

---

## 5. Recommended approach for open-brain Phase 5.5

### Shape

A **slash-command-fronted, preview-and-apply** layer on top of the Phase 5 chat. Mobile-first: a frecency-ordered chip bar above the input is the primary discoverability surface; `@`-mention autocomplete makes targets explicit; an embedding-based suggester (no LLM) promotes the most likely chip when the user types natural language. Writes always go through a proposal card. No autonomous writes, no LLM tool calling, and no LLM-based intent classifier. New notes default to today's daily note unless the user is explicit.

### Intent detection — four-layer cascade

Each layer is cheaper and more reliable than the LLM:

1. **Slash command at message start** — deterministic; the parser routes it. The chip bar (below) is the funnel.
2. **`@`-mention** — explicit target attachment; composes with any slash command and with natural language.
3. **Embedding-based suggester (debounced).** ~600–800 ms after the user stops typing, embed the input and cosine-score against pre-embedded exemplar phrases per command (`/journal`: "today I…", "I felt…"; `/list`: "add X to my Y list"; etc.). If the top match crosses a confidence threshold, **promote** the matching chip to the leading position and optionally show an inline hint ("Looks like a journal entry — `/journal`?"). Runs in tens of milliseconds, no LLM call. Failure mode: a chip in the wrong order — one tap to recover.
4. **Natural-language fallback** — no slash, no `@`, no exemplar match: treat as Phase-5 read-only chat. We do **not** infer write intent from language for v1.

No LLM-based intent classifier. Two reasons: (a) the embedding cascade gets us most of the way at near-zero cost; (b) running an LLM classifier on every turn busts the chat KV cache (see *Caching* below). If embedding suggestions miss too often in practice, we layer in a debounced LLM second-pass — but only as a suggester, never as a router.

The LLM only writes content; routing is mechanical.

### Mobile-first command bar

Phone is the primary input. The chip bar lives above the chat input — above the keyboard on mobile via the `visualViewport` API, above the input on desktop (hover/focus-revealed so it doesn't eat vertical space). Horizontal-scrolling, scroll-snapped, with the chip equivalents of `/save`, `/journal`, `/note`, `/append`, `/list` plus a `+ More` overflow.

Ordering is **frecency**, not raw frequency: `score = count × exp(-age_days / halflife)` (Firefox URL-bar / Sublime palette algorithm). A command used heavily a month ago does not outrank one used five times this week. Stats persist in `.openbrain/command-stats.json` so the order syncs across devices; if cross-device usage patterns diverge enough to matter, demote to per-device storage as a follow-up.

The chip bar is **the** discoverability mechanism. Power users learn the slashes; everyone else taps.

### `@`-mention autocomplete

Typing `@` at a word boundary opens a floating popover anchored to the caret. Match is case-insensitive **infix** (substring) on path, frontmatter `title`, and `aliases[]`. Sort: per-note frecency, then recency, then path length. Selecting inserts a `[[path]]` token (matches existing wikilink convention) or, in the chat input specifically, an `@path` chip the parser hands to slash commands as a target.

Index is in-memory, rebuilt on vault change events. For low-thousands of notes a hand-rolled scorer is faster and simpler than pulling in `fuse.js`. Fuzzy (subsequence) matching is a v2 nice-to-have; infix covers most asks.

This composes with `/append`, `/list`, and any future op that takes a target — same surface for the user, same parser for us.

### Output format — slash syntax, not JSON

When the LLM emits a "tool call" (e.g. proposing an append from natural language), it outputs **the same slash-command syntax the user types**: `/append @lists/grocery eggs, milk`. Three wins:

1. **Cheapest tokens.** ~9 tokens vs ~22 for JSON for a typical op (no quotes, no braces, no commas). Few-shot examples shrink proportionally, which dominates total prompt cost.
2. **Same parser, same code path.** The model is literally completing a sentence in the format we already accept from users.
3. **Self-documenting prompts.** Few-shots read as natural conversational examples, not as structured-output specs the model has to "switch modes" for.

YAML is the fallback for the rare payload that doesn't fit a slash command (e.g. proposing multiple distinct edits in one card). JSON stays in reserve for the case where WebLLM's grammar-constrained `response_format: { type: 'json_object' }` proves to be the only mechanism that hits acceptable reliability on Gemma-class models — to be confirmed in a bench (see §6). **Default to slash commands everywhere it makes sense unless the JSON bench shows a meaningful reliability gap.**

### Caching, batching, deferred organization

The system feels responsive only if we resist calling the LLM on every action. Four cache/scheduler patterns, smallest-to-largest:

1. **WebLLM auto-prefix-reuse (free).** Verified 2026-05-09 against [`web-llm/examples/multi-round-chat`](https://github.com/mlc-ai/web-llm/tree/main/examples): WebLLM compares each `chat.completions.create` call's `messages` against the engine's internal session history and reuses the KV cache for any matching prefix. Turn-N chat calls reuse turn-0..N-1 KVs out of the box, **provided** the system prompt and earlier messages are byte-identical across calls. Implication: don't rewrite earlier messages; don't interleave a different-system-prompt classifier call between chat turns (it busts the cache for both tracks). This is the strongest reason to keep intent classification *out* of the LLM track.
2. **Embedding-based shortcuts** for intent (above) and list dedup. On append, embed the new item against existing list items — if cosine > 0.9, skip silently. Catches "added eggs three times" without involving the LLM.
3. **Suggestion sidecars** for messy notes. Mirror Phase 4's embedding sidecar: each daily note / inbox file gets a `.suggestions.json` with proposed extractions, links, and tags, cached by content-hash and invalidated on edit. UI surfaces them as accept/reject chips when the file is opened. Reuses the existing extraction queue and `GpuLease` cleanly — no new infra.
4. **Daily review prompt.** Once a day on chat open: "You captured 12 items yesterday — want me to organize them?" Batched LLM pass over yesterday's inbox, single human commit covers many items. High leverage because it amortizes LLM cost across many captures and matches how second brains are actually used (PARA, GTD).

Capture is fast and dumb (slash + chip + voice → daily note or named target, no LLM). Organization is deferred and batched (idle-time queue + daily review). This is how Tana, Mem, and Reflect actually work under the hood — fast capture is the moat.

### Where notes live

- **Daily note:** `journal/YYYY-MM-DD.md`, frontmatter `type: journal`. Created on demand if missing.
- **Saved chats:** continue in `.chats/<session-id>.md` (already shipped); add explicit `/save` to copy a chat (or last turn) into `notes/<title>.md` as a regular note, with a backlink to the chat session.
- **Lists:** `lists/<name>.md` with frontmatter `type: list`. Items are markdown bullets. Opinionated convention; documented in README on first sync.
- **Free-form notes:** `notes/<slug>.md` with frontmatter `type: note` and `created_at`.

### How edits get confirmed

Every write op produces a **proposal card** in the chat:

- header: target path + operation (`Append to lists/grocery.md`)
- body: a unified diff (or for new notes, the full content)
- buttons: **Apply**, **Edit then apply**, **Discard**

`Apply` writes through the existing `vault.writeNote` / sync pipeline — it goes to GitHub like any other edit, so undo is `git revert`.

For long-running ops (e.g. summarize a week of journal entries), the preview shows the *proposed* note before write.

### How lists get found and appended to

**Deterministic, not semantic.** When the user says `/list grocery` or "add eggs to grocery list":

1. Look up `lists/grocery.md`. If exact filename match, use it.
2. If not, fall back to scanning `lists/*.md` for any frontmatter `aliases: [grocery, groceries, food]`.
3. If still not found, propose creating a new list — show the proposal card.

The model never picks the target. This solves the "small model picks the wrong note" failure mode by construction. The cost is a vault convention; the user's vault gets a `lists/` folder on first list creation.

For the natural-language path ("add eggs to grocery"), we can ship a tiny intent regex (`/^add (.+) to (?:my )?(\w+) list$/i`) before involving the LLM at all. Most "add X to Y" phrasings fit a small set of templates.

### Minimum schema/conventions in the vault

```yaml
# notes/foo.md
---
type: note            # one of: note, journal, list, person, chat, idea
created_at: 2026-05-09T10:23:00Z
aliases: []           # optional; used for fuzzy resolution of @mentions and lists
---
```

Two new directories: `journal/`, `lists/`. Existing `notes/`, `.chats/`, `.memory/` unchanged. Document in README and in `.openbrain/schema.json`.

### Alternative designs considered

1. **Full tool-calling agent** (LangChain-style ReAct loop with `appendNote`, `createNote`, `findNote` tools). Rejected: WebLLM tool-calling is unreliable on Gemma-class models; failure mode is silent misroutes. Revisit if/when we move to a 12B+ model with proven function-calling.
2. **Pure natural-language with LLM intent classification** (Mem-style "just talk"). Rejected: requires 80%+ classification accuracy, which on-device research suggests we won't hit reliably ([Nature on-device intent paper](https://www.nature.com/articles/s41598-024-63380-6)). Failure mode is user confusion about where things went, which directly violates our "vault is transparent" promise.
3. **The chosen design: slash + `@` + preview/apply.** Picked because every component degrades safely. If the slash parser fails, the user sees a regular chat reply. If the model produces garbage in the proposal, the diff makes it obvious before any write. If the user picks the wrong target, they can edit the proposal before applying.

I'd ship #3. The only thing I'd reach for from #1 later is a single read-only `searchNotes` tool, once we want richer recall.

### Suggested ship order inside Phase 5.5

1. `/save` (chat → note). Zero routing risk; validates the proposal-card UX.
2. `/journal` and "save voice transcript to today's journal." Single deterministic destination.
3. `/note <title>` create-new. Single new-file write, no merge risk.
4. `/list <name>` append-to-list with the deterministic resolver. First write op that touches an existing file.
5. `/append @path` general append. Generalizes #4.
6. *(Stretch)* "I met X" → typed `person` note with extracted fields. Requires the typed-object pattern; only attempt once 1–5 are stable.

Edits/renames/deletes are explicitly **not** in 5.5. They go behind the same proposal-card UX in a later phase, once we have telemetry on how often the model produces a bad proposal.

---

## 6. Open questions

- **How well does Gemma-1B/4B fill our YAML frontmatter shape?** Need a prompt-eval spike with 20–30 representative inputs. If even the typed-object case fails routinely on 1B, we should make typed objects an opt-in 4B+ feature.
- **Slash-command output vs. JSON-mode reliability bench.** ~1 day of focused work; saved for a dedicated session. Precheck (2026-05-09) confirmed WebLLM exposes `response_format: { type: 'json_object' }` with grammar constraints, and the repo ships [`examples/json-mode`](https://github.com/mlc-ai/web-llm/tree/main/examples) and [`examples/json-schema`](https://github.com/mlc-ai/web-llm/tree/main/examples). Caveats: official example uses Llama-3.2-3B (not Gemma); "most models support grammar" is not "all"; Ollama has a known [Gemma JSON-schema repetition-loop bug](https://github.com/ollama/ollama/issues/15502) at 31B that may or may not surface on our smaller variants. Bench design:
    - **Three arms**: (A) slash syntax, unconstrained; (B) JSON-mode, grammar-constrained via `response_format`; (B′) JSON, unconstrained — included if (B) silently degrades. Drop YAML.
    - **Test set**: ~50 inputs across the use-case taxonomy. Mix: ~30% clean intent, ~30% ambiguous, ~20% with explicit `@`-mention, ~20% **decoys** (read-only questions that should NOT produce a write — load-bearing for false-positive rate).
    - **Each input has a ground-truth label**: `{ command, target, content }`.
    - **Runs**: N=3 per input per arm at temp=0.3 + one pass at temp=0 for headline numbers. 50 × 3 × 3 = 450 generations + 150 deterministic = ~30 min wall on a decent GPU.
    - **Models**: bench whatever variant ships as default (probably Gemma 4B). Don't bench 1B unless we ship it.
    - **Decision rule, pre-committed**:
      - Slash semantic accuracy ≥ 85% overall AND ≥ 90% on decoys → ship slash regardless of JSON's number.
      - Slash < 75% AND JSON ≥ 90% → switch to JSON.
      - Anything in between → ship slash, plan a re-bench after Phase 5.5 with real-world inputs.
      - Both < 70% on decoys → reconsider; the embedding-only suggester needs to carry more weight.
    - **Time breakdown**: precheck (done, 15 min) + harness (`/bench` route, 2–3 hr) + test set authoring (1–2 hr) + few-shot prompts per arm (1 hr) + running (~30 min hands-off) + scoring (1–2 hr) + write-up (30 min) ≈ 1 focused day.
    - **Pre-bench prior**: slash wins for short flat ops; JSON-mode might win on the rare nested case (multi-edit cards). The decoy subset is the load-bearing measurement — getting *no* false writes matters more than getting all true writes.
- **WebLLM KV-cache reuse — confirmed 2026-05-09; no further spike planned.** WebLLM auto-reuses KV cache when `messages` is a strict prefix-extension of the previous call within the same engine session (verified against the multi-round-chat example). The cache is single-track per engine, so an LLM-based intent classifier interleaved between chat turns would bust the cache for both. Reinforces the embedding-based suggester decision.
- **Should the daily note be created lazily or on app open?** Lazy is simpler; on-open lets us pre-load it for fast `/journal`.
- **Reminders/follow-ups.** We have no notification surface. Options: (a) skip entirely, (b) maintain `reminders.md` as a dated list and surface overdue items in the Chat sidebar on open, (c) defer to a later phase. My weak preference is (b) — cheap, vault-native, no platform dependency.
- **Does `/save` capture the whole session or the last turn?** Both have use; default to last turn with a `--all` modifier feels right but needs a UX check.
- **Conflict behavior on append.** If the user appends locally while a remote edit is mid-flight, our existing three-tier conflict path will catch it, but proposals racing applies might double-write. Need to confirm we can serialize proposal-apply behind the existing write lock.
- **Auto-organize via suggestion sidecars + daily review.** Direction is settled (see §5 *Caching, batching, deferred organization*). Open: exact sidecar schema, daily-review trigger surface (chat-open prompt vs. dedicated tab), and how organize jobs are prioritized in the existing extraction queue against embedding work.
- **Voice + slash commands.** Web Speech API isn't going to reliably transcribe `/journal`. Either we accept "computer, journal mode" style hot-words in voice input and rewrite to `/journal`, or we expose mic-mode shortcuts in UI rather than via the transcript. Worth a small spike.
