# Open Brain — Postmortem & Project Wind-Down

**Date:** 2026-05-20
**Status:** Project abandoned. This document records why, what was learned, and where to go instead.
**Final commit:** `714bfb1` (post-Phase 5.9.2 + docs archive split).
**Final test count:** 446 across 53 files. `npm run check` green.

## TL;DR

Open Brain set out to be a fully local, browser-only second brain — notes in
GitHub, retrieval over on-device embeddings, chat through an in-browser WebLLM
model. The notebook half of that vision shipped and works. The conversational
chat half repeatedly failed in user testing because **1–2B parameter local
models, the only class WebLLM can practicably load in a browser, lack the
multi-turn coherence and instruction-following required to feel like a useful
chat-with-your-notes interface.**

The Obsidian community already ships a plugin
([Local LLM Helper](https://community.obsidian.md/plugins/local-llm-helper))
that covers the same intent on a mature notebook substrate, hits any
OpenAI-API-compatible backend (Ollama, LM Studio, etc.), and therefore is not
bound to the small-model capability ceiling. Continuing Open Brain would mean
re-building a notebook from scratch, with worse hardware constraints, to chase a
chat experience that the underlying model class cannot deliver yet.

The right call is to stop.

## What was built

- **Sync engine** (Phase 3) — isomorphic-git over LightningFS in IndexedDB, with
  conflict markers, autosave debounce, and a real-time status bar. Solid.
- **Vault model + Browse tab** (Phase 2) — markdown-on-disk, hierarchical tree,
  conflict-aware inline diff resolution, multi-format frontmatter.
- **Memory pipeline** (Phase 4) — Transformers.js embeddings (MiniLM-L6),
  sidecar JSON per note, queued + persisted across reloads, GPU-leased so the
  LLM and the embedder don't fight over WebGPU.
- **Chat + retrieval** (Phase 5) — WebLLM Gemma/Llama variants, streaming
  tokens, RAG over notes + chats with chunk weighting, citation rendering.
- **Conversational note ops** (Phase 5.5–5.9.2) — eleven slash commands
  (`/save /journal /note /append /list /find /related /edit /organize /archive
  /tag /help`), proposal-card review-and-apply UX, intent suggester,
  capabilities + persona system-prompt layers, conversation-history sliding
  window, retrievable help corpus, current-session self-retrieval filter.
- **Design + a11y pass** (Phase 8, 9) — token system, focus-glow,
  reduced-motion sweep, toast surface, ARIA labels and live regions.
- **GitHub App sign-in + same-origin proxy** for OAuth + git-smart-HTTP.

That's an honest amount of working software. The plumbing was the easy part.

## Why we stopped

### The capability ceiling, in detail

The WebLLM-shipped variants Open Brain could practicably load on consumer
hardware are 1–3B parameter class models — Gemma 2B, Llama 3.2 1B/3B,
Qwen 2.5 0.5–3B. For context, GPT-3.5 is ~175B, Claude 3 Haiku is rumoured
~30B. The capability gap is **roughly two orders of magnitude**, and it shows
up in exactly the place chat-with-your-notes lives: multi-turn coherence under
noisy retrieval context.

Concrete failure modes observed in real-user testing, including after Phase
5.9.2 shipped:

- **Stuck-loop responses.** A recent assistant turn ("Your notes are
  organized.") gets latched onto and repeated for three or four subsequent
  unrelated user turns. The model is pattern-matching the dominant token in
  its context rather than responding to the most recent question.
- **Out-of-order answers.** User asks question N+1; model answers question N.
  Robust across system-prompt directives that explicitly say "answer the most
  recent message only."
- **Hallucinated actions.** Model claims to have run a slash command it never
  ran, narrating the action as if it executed. Even after B1 retrieval
  filtering prevented the *current* session's slash-command lines from being
  re-fed, the model still confabulated.
- **Brittle intent classification.** Small talk vs. notes-question gets
  conflated. "I need a toothbrush" — observational content — gets answered
  with "Your cat is named Belle" because the retrieval block dominates the
  prompt.

These are **structural** at this model class. No amount of prompt engineering,
retrieval filtering, persona tuning, or context windowing closes the gap
reliably. Phase 5.9 (capabilities prompt + persona), 5.9.1 (history trim), and
5.9.2 (indexed help corpus + B1 self-retrieval filter + anchor directive) each
addressed concrete sub-failures, but the underlying behavior — small models
parroting prominent context tokens — persisted.

### Why a bigger model wasn't the answer for this project

A 7B-class model (Llama 3.1 8B, Qwen 2.5 7B) would meaningfully reduce these
failures. But:

- WebLLM's 8B variants are ~5GB compressed; cold-load on a fresh browser is
  multi-minute. WebGPU memory headroom on integrated graphics is borderline.
- iOS Safari WebGPU support is incomplete; the "just visit a URL on any
  device" property breaks for the platform the user actually wanted to use
  for daily capture.
- Running Ollama or LM Studio outside the browser would solve the model size
  problem but breaks the browser-only premise — at which point the user is
  installing a desktop daemon and might as well use a desktop note app on top
  of it. Which brings us to:

### Obsidian + Local LLM Helper covers the intent

[Local LLM Helper](https://community.obsidian.md/plugins/local-llm-helper) is
an actively maintained Obsidian community plugin (v2.4.6 at time of writing,
31 releases) that:

- Talks to any OpenAI-API-compatible backend: Ollama, LM Studio, vLLM,
  LocalAI, text-generation-webui, or OpenAI itself if the user wants cloud.
- Ships RAG over indexed notes, semantic search, related-notes sidebar,
  text-transform commands, customizable personas, web search integration,
  reasoning extraction.
- Lives inside Obsidian's mature vault/editor/sync ecosystem (backlinks,
  graph, Dataview, Tasks, mobile apps, real conflict-aware sync).

Continuing Open Brain would mean re-implementing Obsidian's notebook UX from
scratch while constrained to small models. Even if the chat-coherence problem
were solved (it isn't), the notebook product would lose this comparison on
polish, ecosystem, and platform reach.

## Lessons learned

In rough order of how load-bearing each was.

### 1. The "local LLM" framing implied capabilities it doesn't have yet

The original premise — *"chat with your notes, fully local, private"* —
sounds equivalent to ChatGPT-but-private. It is not. The model size that fits
in a browser today is the model size that produces the failure modes
documented above. The framing led to product decisions (chat as the primary
surface) that the underlying technology cannot support reliably.

**For future projects:** treat model size as a hard constraint, not a sliding
knob. Decide what experience the smallest viable model can actually deliver,
and design the product around that — not around the experience the largest
available model could deliver in principle.

### 2. RAG masks but does not fix small-model weakness

A lot of the design assumed "if the right note is in retrieval, the model
will draw on it correctly." For some questions ("What's my cat's name?")
that's true. For most multi-turn or intent-classification scenarios, the
model treats retrieval as noise that overrides the user's actual question,
or as context to confabulate from. Phase 5.5–5.9.2's retrieval engineering
was solid; the model's ability to *use* that retrieval coherently was the
bottleneck.

**For future projects:** if the model can't reliably do single-turn QA over
short context, it won't magically do better with longer context. Test the
floor first.

### 3. Slash commands carried most of the actual value

The deterministic verbs (`/journal`, `/save`, `/find`, `/append`, `/list`,
`/organize`, `/edit`, `/related`, `/archive`, `/tag`, `/help`) worked. They
produced predictable output, never hallucinated, and the proposal-card UX
let users review before applying. These were the parts users could rely on.

The LLM-mediated chat surface was *less* reliable than the structured verbs
it was meant to subsume. This is a useful inversion: the "AI-powered" path
was worse than the "rule-based" path for most of the things users actually
wanted to do.

**For future projects:** structured verbs first, AI fallback second. The
opposite ordering is tempting because AI feels modern, but for a small-model
budget the structured verbs do more work per unit of reliability.

### 4. Vibecoding scales further than expected on plumbing, less on judgment

The infrastructure shipped quickly: vault, sync, embeddings, retrieval, chat
streaming, conflict resolution, design pass, accessibility surface. The
parts that needed iterative product judgment — what should the chat actually
*do*, where does the model help vs. hurt, when should we trust retrieval —
those were where the project got stuck. Generating code is faster than
generating product clarity. The bottleneck was not engineering throughput.

**For future projects:** budget the product-decision time, not the coding
time. Treat "I can build this in a weekend" as a warning sign about the
scope of the actual decision space, not a license to skip it.

### 5. The browser-only premise has costs the product can't always pay

The "just visit a URL, no install" property is genuinely lovely. It also
constrains model size, model load time, model memory footprint, platform
reach (iOS WebGPU still spotty), and excludes the Ollama / LM Studio class
of backends that would have closed the chat-coherence gap. Not every product
can afford that constraint, and the cost wasn't visible at the start of
the project.

**For future projects:** name the distribution model as a feature, then
audit honestly which capabilities it forecloses. If the foreclosed
capabilities are load-bearing, the distribution model has to give.

## What survives as reference

The code is preserved at the final commit. Phases 0–5.9.2 are documented in
[PHASES-COMPLETED-2026-04-17.md](./PHASES-COMPLETED-2026-04-17.md) with the
original task lists, exit criteria, and decisions. The
[Architecture](./ARCHITECTURE-2026-04-17.md),
[Constraints](./CONSTRAINTS-2026-04-17.md),
[Tech stack](./TECH-STACK-2026-04-17.md), and
[Design](./DESIGN-2026-04-17.md) docs remain accurate as of the final commit.

Genuinely-useful pieces another project might cannibalise:

- **`src/lib/sync/`** — isomorphic-git over IndexedDB with same-origin proxy
  for GitHub OAuth + smart-HTTP. The auth + CORS workaround took two passes
  to get right; the current shape is correct.
- **`src/lib/memory/`** — embedding queue with GPU lease arbitration,
  sidecar persistence, chat-aware chunker tagging chunks with role +
  messageIndex.
- **`src/lib/chat/slash/`** — slash command parser + dispatch + proposal
  flow. Deterministic verbs over a vault with a review-before-write UX.
- **`src/lib/llm/help-corpus.ts`** — pattern for shipping app-bundled,
  retrievable documentation alongside code, version-marked for forced
  refresh.

## Where to go instead

For the original intent (a private second brain with AI assistance):

- **[Obsidian](https://obsidian.md/)** + **[Local LLM Helper](https://community.obsidian.md/plugins/local-llm-helper)** + **[Ollama](https://ollama.com/)** running a 7B-class model. Closest fit to the original
  vision, with a mature substrate and a model class that can actually
  sustain multi-turn chat.
- **[Logseq](https://logseq.com/)** — open-source alternative to Obsidian.
  Local-first, block-based, has its own AI plugins.
- **[AnythingLLM](https://anythingllm.com/)** — desktop app with built-in
  RAG over local documents; less notebook-shaped but covers the
  chat-with-your-notes use case directly.

For the engineering exercise itself: a known endpoint, with the original
goals reframed honestly, was the point. That endpoint has been reached.

---

_Repo preserved as-is. No further development planned._
