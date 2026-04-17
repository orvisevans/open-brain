# Open Brain — Architecture Sketch

**Date:** 2026-04-17
**Status:** First sketch, pre-implementation
**References:** [CONSTRAINTS-2026-04-17.md](./CONSTRAINTS-2026-04-17.md), [TECH-STACK-2026-04-17.md](./TECH-STACK-2026-04-17.md)

---

## 1. High-Level Picture

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        direction TB

        subgraph UI["UI Shell — SvelteKit SPA"]
            direction LR
            ChatTab["Chat"]
            BrowseTab["Browse"]
            MemoryTab["Memory"]
            SetupTab["Setup"]
        end

        State["State / Coordination<br/>(Svelte runes + module stores)"]

        subgraph Modules["Domain Modules"]
            direction LR
            Auth["auth/"]
            Vault["vault/"]
            Sync["sync/"]
            LLM["llm/"]
            Embed["embed/"]
            MemPipe["memory/"]
            Compat["compat/"]
        end

        subgraph Platform["Platform Storage & Compute"]
            direction LR
            FS["lightning-fs<br/>(IndexedDB)"]
            GPU["WebGPU<br/>WebLLM &amp; Transformers.js"]
            IDB["IndexedDB<br/>queues, tokens, chat"]
        end

        UI --> State
        State --> Auth
        State --> Vault
        State --> Sync
        State --> LLM
        State --> Embed
        State --> MemPipe
        State --> Compat

        Vault --> FS
        Sync --> FS
        LLM --> GPU
        Embed --> GPU
        Auth --> IDB
        MemPipe --> IDB
    end

    GitHub[("GitHub API<br/>OAuth Device Flow<br/>+ private repo")]
    Auth -.-> GitHub
    Sync -.-> GitHub
```

---

## 2. Module Map

| Module | Responsibility | Key Dependencies |
|---|---|---|
| **`auth/`** | GitHub Device Flow; token storage; current user info | GitHub API |
| **`vault/`** | Read/write notes + sidecars; path conventions; markdown+frontmatter parsing; wikilink extraction | `isomorphic-git/lightning-fs` |
| **`sync/`** | Clone/pull/push/merge; conflict detection & resolution tiers; debounced auto-sync | `isomorphic-git`, `vault`, `auth` |
| **`attachments/`** | `AttachmentStore` interface; `GitHubRepoAttachments` MVP impl | `vault`, `sync` |
| **`transcribe/`** | `Transcriber` interface; `WebSpeechTranscriber` MVP impl | Web Speech API |
| **`llm/`** | `LLMRuntime` wrapper around WebLLM; streaming; model download/swap; VRAM coordination | `@mlc-ai/web-llm` |
| **`embed/`** | `Embedder` wrapper around Transformers.js; batch embedding | `@xenova/transformers` |
| **`memory/`** | Sidecar read/write; hash invalidation; embedding queue; LLM extraction queue; retrieval | `vault`, `embed`, `llm` |
| **`chat/`** | Chat session state; message history; orchestrates retrieval + LLM turn | `memory`, `llm`, `transcribe` |
| **`compat/`** | Detect WebGPU, Web Speech API, OPFS, storage quota; expose capability flags | platform APIs |
| **`config/`** | User preferences (model variant, sync repo, dark mode) persisted to IndexedDB and to `.openbrain/config.json` in the repo | `vault` |
| **`ui/`** | Svelte components, routes, layout | all of the above |

Each module exports a narrow, testable API. UI does not reach past the module boundary.

---

## 3. Data Models

Sketched in TypeScript style for clarity. Actual code may diverge.

```ts
// vault
type NotePath = string;   // POSIX-style, relative to repo root, e.g. "notes/project.md"

interface Note {
  path: NotePath;
  content: string;          // full markdown body (frontmatter excluded)
  frontmatter: Record<string, unknown>;
  lastModified: number;     // ms epoch
}

interface WikilinkRef {
  from: NotePath;
  to: NotePath | string;    // may be unresolved
  display?: string;         // [[target|display]]
}

// memory
interface Sidecar {
  source: NotePath;
  sourceHash: string;       // sha256 of source file contents
  extractedAt: number;
  model: string;            // e.g. "gemma-4-4b-it"
  schemaVersion: number;

  summary: string;
  entities: Entity[];
  facts: string[];
  topics: string[];
  links: WikilinkRef[];

  embeddings: EmbeddingChunk[];  // inline in frontmatter as base64
}

interface Entity { type: string; name: string; }

interface EmbeddingChunk {
  chunkIndex: number;
  text: string;
  vector: Float32Array;     // 384 dims for all-MiniLM-L6-v2
}

// chat
type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  retrievedContext?: NotePath[];   // which notes informed this turn
}

// sync
type SyncStatus =
  | { kind: "idle" }
  | { kind: "syncing"; phase: "commit" | "push" | "pull" | "merge" }
  | { kind: "conflict"; paths: NotePath[] }
  | { kind: "error"; message: string };
```

---

## 4. Repo Storage Layout

Laid out in the user's GitHub repo and mirrored in lightning-fs:

```mermaid
flowchart TD
    Root(["repo root"])

    Root --> Notes["notes/"]
    Root --> Attach["attachments/"]
    Root --> Memory[".memory/<br/><i>mirrors notes/ hierarchy</i>"]
    Root --> OB[".openbrain/"]
    Root --> Readme["README.md<br/><i>auto-generated on first sync</i>"]

    Notes --> N1["daily-2026-04-17.md"]
    Notes --> N2["project-brain.md"]

    Attach --> A1["diagram.png"]
    Attach --> A2["meeting-notes.pdf"]

    Memory --> M1["daily-2026-04-17.md<br/><i>sidecar</i>"]
    Memory --> M2["project-brain.md<br/><i>sidecar</i>"]

    OB --> C1["config.json<br/><i>model preference, sync prefs</i>"]
    OB --> C2["schema.json<br/><i>current memory schema version</i>"]
```

Conflict backups (tier 3 of resolution) land next to their source, e.g.:

```mermaid
flowchart LR
    Src["notes/project-brain.md"] --- Backup["notes/project-brain.md.conflict-2026-04-17T10:23:00.md"]
```

---

## 5. Browser Storage Layout

Beyond the git working copy, we have a few separate IndexedDB stores:

| Store | Purpose |
|---|---|
| `openbrain-fs` | lightning-fs backing store (all repo files) |
| `openbrain-auth` | OAuth token + GitHub user info |
| `openbrain-queues` | Pending embedding jobs, pending LLM extraction jobs, retry state |
| `openbrain-chat` | Chat history (not synced to repo — ephemeral per device) |
| `openbrain-cache` | Transient UI state: last opened note, scroll positions |
| WebLLM's own store | Model weights (managed by `@mlc-ai/web-llm`) |
| Transformers.js cache | Embedding model weights |

**Chat history note:** not synced by default. Open question (filed in constraints §13 as adjacent to the "AI introspects memory" question) whether chat history should be synced — skipped for MVP because (a) it's noisy, (b) it inflates repo size, (c) privacy-conscious users may prefer it stay device-local.

---

## 6. Key Abstractions (Interfaces)

### `Transcriber`
```ts
interface Transcriber {
  isAvailable(): boolean;
  start(): AsyncIterable<TranscriptEvent>;   // streams partial + final results
  stop(): Promise<void>;
}

type TranscriptEvent =
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; message: string };
```
MVP: `WebSpeechTranscriber`. Future: `WhisperTranscriber`.

### `AttachmentStore`
```ts
interface AttachmentStore {
  put(id: string, blob: Blob): Promise<AttachmentRef>;
  get(ref: AttachmentRef): Promise<Blob>;
  delete(ref: AttachmentRef): Promise<void>;
}

interface AttachmentRef {
  provider: "github-repo" | "dropbox" | "s3";
  path: string;            // provider-scoped location
}
```
MVP: `GitHubRepoAttachments` (writes under `attachments/`).

### `LLMRuntime`
```ts
interface LLMRuntime {
  loadModel(id: GemmaVariant, onProgress: (p: LoadProgress) => void): Promise<void>;
  unloadModel(): Promise<void>;
  chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<string>;  // token stream
  currentVariant(): GemmaVariant | null;
}
```

### `Embedder`
```ts
interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

These interfaces are what the rest of the app depends on. Concrete implementations live behind them.

---

## 7. Sequence Diagrams

### 7a. Chat turn (text input)

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Chat UI
    participant M as Memory
    participant E as Embedder
    participant V as Vault
    participant L as LLMRuntime

    U->>UI: Types question, hits send
    UI->>M: retrieve(query)
    M->>E: embed([query])
    E-->>M: queryVector
    M->>V: readSidecars()
    V-->>M: sidecars[]
    M->>M: cosine sim → top N (default 5)
    M-->>UI: retrievedContext{ summaries, entities, noteRefs }
    UI->>L: chat([system, ...history, augmented user msg])
    loop streaming tokens
        L-->>UI: token
        UI->>UI: append to assistant msg
    end
    UI->>UI: persist message (IndexedDB chat store)
```

### 7b. Chat turn (voice input)

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Chat UI
    participant T as Transcriber
    participant Rest as (rest of turn as 7a)

    U->>UI: Taps mic button
    UI->>T: start()
    loop speaking
        T-->>UI: partial transcript
        UI->>UI: show in input box (greyed)
    end
    U->>UI: Taps stop (or silence timeout)
    T-->>UI: final transcript
    UI->>T: stop()
    UI->>Rest: same path as 7a with transcribed text
```

### 7c. Edit → sync → memory refresh

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Browse UI
    participant V as Vault
    participant S as SyncEngine
    participant MQ as MemoryQueue
    participant E as Embedder
    participant L as LLMRuntime

    U->>UI: Types in editor
    UI->>V: debouncedWrite(path, content) [~3s idle]
    V->>V: write file to lightning-fs
    V->>S: notify change
    S->>S: commit + push (debounced ~5s)
    V->>MQ: enqueue(path, reason=edit)

    Note over MQ,E: Embeddings path (fast, ~30s debounce)
    MQ->>E: embed(chunks)
    E-->>MQ: vectors
    MQ->>V: update sidecar embeddings

    Note over MQ,L: Extraction path (slow, idle + battery gated)
    MQ->>MQ: wait for idle >2min AND (charging OR batt>50%)
    MQ->>V: hash note → compare to sidecar.sourceHash
    alt hashes match
        MQ->>MQ: skip (cache hit)
    else differ or missing
        MQ->>L: extract(noteContent)
        L-->>MQ: {summary, entities, facts, topics}
        MQ->>V: rewrite sidecar
        V->>S: notify change
        S->>S: commit + push sidecar
    end
```

### 7d. Conflict resolution (three-tier)

```mermaid
sequenceDiagram
    participant S as SyncEngine
    participant G as isomorphic-git
    participant UI as Conflict UI
    participant V as Vault

    S->>G: pull (from GitHub)
    G->>G: attempt merge
    alt no overlap — tier 1
        G-->>S: auto-merged
        S->>S: commit merge, push
    else overlap — tier 2
        G-->>S: conflict markers in file
        S->>UI: show conflict resolver for path
        UI->>V: user-resolved content
        V->>G: commit resolution
        S->>S: push
    else merge engine errors — tier 3
        G-->>S: failure
        S->>V: write backup file (path.conflict-<ts>.md)
        S->>V: take remote version as canonical
        S->>S: commit both (canonical + backup), push
        S->>UI: notify user of backup file created
    end
```

### 7e. First-run setup

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Setup UI
    participant C as Compat
    participant A as Auth
    participant GH as GitHub
    participant S as SyncEngine
    participant L as LLMRuntime

    U->>UI: Opens app for first time
    UI->>C: check capabilities
    C-->>UI: {webgpu, webspeech, storage}
    UI->>U: show compatibility matrix
    U->>UI: clicks "Sign in with GitHub"
    UI->>A: startDeviceFlow()
    A->>GH: POST /login/device/code
    GH-->>A: user_code + verification_uri
    UI->>U: display code, open verification URL
    loop poll
        A->>GH: POST /login/oauth/access_token
        alt pending
            GH-->>A: authorization_pending
        else success
            GH-->>A: access_token
        end
    end
    A->>A: store token
    UI->>U: pick/create private repo
    U->>UI: selects repo
    UI->>S: clone(repo)
    S->>GH: git clone via HTTP
    GH-->>S: repo contents
    UI->>U: pick Gemma variant
    U->>UI: selects 4B
    UI->>L: loadModel("gemma-4-4b-it")
    L->>L: download weights (progress shown)
    UI->>U: "You're set up. Go to Chat."
```

---

## 8. Module Dependency Graph

```mermaid
graph TD
    UI[UI Shell / Routes]
    Chat[chat/]
    Memory[memory/]
    Embed[embed/]
    LLM[llm/]
    Vault[vault/]
    Sync[sync/]
    Auth[auth/]
    Attach[attachments/]
    Transcribe[transcribe/]
    Compat[compat/]
    Config[config/]

    UI --> Chat
    UI --> Memory
    UI --> Vault
    UI --> Sync
    UI --> Auth
    UI --> Compat
    UI --> Config
    UI --> Transcribe

    Chat --> Memory
    Chat --> LLM
    Chat --> Transcribe

    Memory --> Vault
    Memory --> Embed
    Memory --> LLM

    Sync --> Vault
    Sync --> Auth

    Attach --> Vault
    Attach --> Sync

    Config --> Vault
```

No cycles. `vault` is the most depended-on module; it stays pure (no network, no LLM, no UI).

---

## 9. Concurrency & Coordination

A few real constraints force coordination between modules:

### VRAM / memory pressure
- WebLLM holds the Gemma weights in GPU memory.
- Transformers.js also uses WebGPU when available.
- On a 4 GB-VRAM device loading Gemma-4B, embedding-in-parallel can OOM.
- **Strategy:** `LLMRuntime` and `Embedder` share a **`GpuLease`** single-slot lock. When LLM is streaming a chat turn, embedding jobs in the queue wait. When idle, embeddings run freely.
- Small models (Gemma-1B) with headroom can skip the lock — `GpuLease` detects available VRAM via WebGPU limits.

### Sync coalescing
- Rapid edits cause many file writes. We don't want one commit per keystroke.
- `SyncEngine` debounces commits (~5s idle) and batches all changed files into a single commit.
- Sidecar rewrites arriving from the memory queue piggyback onto the next commit window when possible.

### Network awareness
- Sync pauses (without error) when offline. UI shows a pending-sync badge. Resumes when back online.
- Model downloads pause/resume similarly (WebLLM handles this internally).

### Battery awareness (mobile)
- Memory extraction queue reads `navigator.getBattery()` and pauses LLM extraction when battery < 50% and not charging.
- Embedding (cheap) is not gated on battery.

---

## 10. Retrieval Algorithm (concrete)

For each chat turn:

1. **Embed the query** (Embedder, ~50ms on mobile).
2. **Load sidecars** from `.memory/` via Vault. Sidecars are small — typical size ~2–10 KB.
3. **Cosine similarity** of query vector against each chunk vector across all sidecars.
4. **Rank and select top-K chunks** (default K=5, user-tunable post-MVP).
5. **Assemble context:**
   ```
   System: You are the user's second brain. Answer using the provided notes.
   Context:
     - [summary from note A]
     - [matched chunk from note B with [[wikilink]] preserved]
     - ...
   User: <original query>
   ```
6. **Hand to LLMRuntime.chat()** and stream tokens to UI.
7. **Record `retrievedContext: NotePath[]`** on the assistant message for transparency (UI can show "based on: note A, note B").

**Context budget:** target ~70% of Gemma's context window for retrieved content, leaving ~30% for history + response. Drop lowest-scoring chunks first if overflow.

---

## 11. Build & Deploy

- `npm run build` → static output in `build/`.
- Deploy target: **Cloudflare Pages** (recommendation, not locked). Alternatives: Netlify, GitHub Pages.
- No environment variables at build time — app is pure static, all runtime config happens in the browser against the user's own GitHub.
- CI: Vitest + Playwright on push; Lighthouse PWA audit on main.

---

## 12. Known Architectural Risks

1. **iOS Safari gap.** No WebGPU → no local LLM. Browse + sync will still work; Chat tab must degrade gracefully with a clear message on the compat page.
2. **Large repos.** Cloning a 1000-note repo into lightning-fs is fine; a 50 000-note repo may hit IndexedDB quota issues. Out of scope for MVP but worth measuring once real users exist.
3. **Model-switch invalidates some memory.** Changing from Gemma-4B to Gemma-1B doesn't invalidate sidecars (the extraction output is the same shape), but quality changes. `model:` field on sidecars lets us surface this ("extracted with a smaller model; consider re-running").
4. **Token storage.** IndexedDB is origin-isolated but not encrypted at rest. XSS is the main threat; CSP + no third-party JS is our mitigation. WebAuthn-based encryption is a post-MVP hardening step.
5. **WebLLM Gemma 4 support.** Assumed based on WebLLM's track record of shipping new Gemma variants quickly. Verify during first spike.

---

## 13. What's intentionally _not_ in this sketch

- **Error taxonomy** — covered once we build. Keep errors typed at module boundaries.
- **Exact Tailwind theme tokens** — UI design phase.
- **Keyboard shortcuts** — UX phase.
- **Onboarding copy** — content phase.
- **Specific chunking algorithm for embeddings** — will be validated empirically (paragraph-split vs. fixed-window vs. markdown-section-aware). Default plan: split on `##` headings with a 400-token fallback cap.

---

## 14. Next steps

1. Validate this sketch end-to-end with a **walking skeleton**:
   - SvelteKit SPA shell with three routes
   - Device-flow auth against a throwaway GitHub App
   - Clone a test repo into lightning-fs
   - Load Gemma-1B in WebLLM (smallest viable)
   - Embed one string with Transformers.js
   - Everything visible in the UI with zero styling
2. If skeleton works, proceed to module-by-module implementation in the order of the dependency graph (Vault first, UI last).
3. If skeleton blocks on anything, revise this doc before implementing.
