# Open Brain — Constraints

**Date:** 2026-04-17
**Status:** Constraint-building stage (pre-architecture)

---

## 1. Core Goal

A personal "second brain" knowledge management app with three defining properties: **no installation**, **runs offline**, and **fully private and secure**. Single-user by design — not a multi-tenant SaaS.

---

## 2. Hosting & Deployment

- **Static hosting only.** No server-side backend. (Netlify, Cloudflare Pages, GitHub Pages all acceptable.)
- **Progressive Web App (PWA).** Service worker enables full offline use after first load; browser can prompt "Add to Home Screen" on mobile.
- **All compute is client-side.** No server-side processing of user content, ever.

---

## 3. Authentication

- **GitHub OAuth is the only auth provider.** No email/password, no Google, no other providers.
- OAuth token stored locally (IndexedDB).
- No server-side session management; no server to manage.

---

## 4. AI / Model

- **Gemma 4 runs locally in-browser** via WebLLM / WebGPU. No external inference API calls.
- **Gemma variant is user-selectable** (e.g., 1B / 4B / 12B). UI exposes download size, RAM requirements, and expected speed per option.
- Model weights downloaded once on first use, then cached in browser storage.
- **Voice input via Web Speech API** for MVP. Transcription layer must be abstracted so Whisper (via `whisper.cpp` WASM) can drop in later as a "private/accurate mode."
- **Voice output: skipped for MVP.** May add later for a fully conversational interface.
- AI uses a **memory-palace-style retrieval system** (extracted entities + summaries + local embeddings) rather than naïve RAG, to conserve Gemma's context budget.

---

## 5. Data Format & Storage

- **Markdown (`.md`) with YAML frontmatter** is the canonical format. Human-readable outside the app.
- **Obsidian-style `[[wikilinks]]`** between notes.
- **Plain text editing only for MVP.** Rich markdown preview deferred to a later version.
- **Attachments stored as binary blobs in the GitHub repo for MVP.** An abstraction layer wraps attachment storage so external providers (Dropbox, S3, etc.) can be swapped in later without touching the note layer.
- Local working copy in **IndexedDB / OPFS**.

---

## 6. Sync

- **Primary remote: user's own private GitHub repo.** Uses the OAuth token from auth — no separate credentials.
- **Automatic sync on edit**, debounced (2–5 seconds idle after last keystroke).
- **Conflict resolution — three-tier strategy:**
  1. **Auto-merge (3-way diff)** when edits don't touch the same lines. Handles the ~90% case silently on a single-user-multi-device setup.
  2. **In-file conflict markers** (`<<<<<<< local` / `>>>>>>> remote`) with a "resolve conflict" UI when edits overlap.
  3. **Last-write-wins with timestamped backup file** (`note.md.conflict-2026-04-17T10:23:00.md`) as the absolute fallback. Nothing is ever lost.
- Memory sidecar files (see §8) also sync, so expensive extraction runs once across all devices.

---

## 7. Privacy & Security

- **Zero server-side user data.** No analytics, no telemetry, no logging of notes or chat history.
- **No third-party CDN scripts.** All dependencies self-hosted / bundled.
- **AI inference never leaves the device.** All LLM calls are local.
- Notes only ever touch the user's own GitHub repo.
- **CSP headers** to prevent XSS.

---

## 8. Memory System (the "second brain" engine)

### Retrieval approach
- Memory-palace-style, not naïve RAG.
- **Extraction layer:** when notes are saved/edited, a pass pulls out entities, facts, and summaries → stored as structured records.
- **Retrieval layer:** for each chat turn, retrieve tiny dense summaries first; fetch full note content only if the model asks for it (tool-use style).
- **Embeddings:** `all-MiniLM-L6-v2` via `transformers.js` (~25 MB, 384 dims, 512-token context). Not user-selectable — one less decision for the user.

### Sidecar caching
- **Cache LLM extraction output in a sidecar file per note**, stored in a mirrored `.memory/` directory at the repo root:
  ```
  notes/project-brain.md
  .memory/project-brain.md
  ```
- **Sidecar format:**
  ```markdown
  ---
  source: notes/project-brain.md
  source_hash: sha256:3f8a9c...
  extracted_at: 2026-04-17T10:00:00Z
  model: gemma-4-4b-it
  schema_version: 1
  ---

  ## Summary
  ...

  ## Entities
  - ...

  ## Facts
  - ...

  ## Topics
  - ...

  ## Links
  - [[related-note]]
  ```
- **Schema versioning from day one.** `schema_version` lets us detect outdated sidecars when the prompt/fields change and lazily rebuild.
- **Embeddings stored inline in sidecar frontmatter as base64.** Keeps "one cache file per note" mental model clean.

### Invalidation
- On every memory pass: hash current note → compare to `source_hash` in sidecar → skip if match, re-extract if differ or sidecar missing.

### Extraction triggers — split by cost
- **Embeddings (cheap):** debounced on edit (~30s after last keystroke). Keeps search fresh.
- **LLM extraction (expensive):** lazy queue, processed when:
  - User idle > 2 minutes, AND
  - On mobile: device is charging OR battery > 50%
  - OR user taps "Refresh memory" in the Memory tab
- Memory tab shows pending queue size (e.g., "3 notes pending indexing") with manual trigger.

---

## 9. Platform & Browser Support

- **Must work on mobile and desktop browsers.** Chrome, Firefox, Safari, Edge.
- **No minimum screen size.**
- **WebGPU is required for local LLM.** Currently limited support on iOS Safari and Firefox — this may block Gemma on those browsers.
- **Browser compatibility page:** on first load, detect WebGPU + Web Speech API support and show a compatibility matrix (e.g., ✅ Chrome/Edge desktop, ⚠️ Firefox, ❌ iOS Safari for AI features) with clear guidance on what works where.

---

## 10. UI

### Three tabs
1. **Chat** — Gemma conversation with voice + text input.
2. **Browse** — markdown file browser/editor. Plain text MVP; rich preview later.
3. **Memory** — direct view of the extracted memory records (entities, summaries, links). User can inspect what the AI "knows," manually trigger reindexing, and see the pending extraction queue.

### Search
- **Full-text search across notes** lives in the Browse tab via the GitHub Search API (online-only).
- **Degrade gracefully offline** to local search over cached notes.
- The AI does *not* use full-text search — it relies on the memory-palace retrieval system (see §8) to conserve tokens.

### Responsive
- Touch-friendly on mobile.
- No minimum screen size.

---

## 11. Explicit Non-Goals (MVP)

- No real-time collaboration
- No server-side AI processing
- No non-GitHub auth
- No native mobile apps
- No plugin / extension system
- No rich markdown rendering (v2)
- No voice output (may add later)
- No AAAK or lossy compression dialects (see §12)
- No user-selectable embedding model

---

## 12. Post-MVP Ideas (filed, not committed)

- **Voice output (TTS)** for fully conversational chat.
- **Whisper transcription** as "private/accurate mode" (abstraction already in place).
- **Rich markdown rendering / preview.**
- **External attachment storage** (Dropbox, S3) via the existing abstraction layer.
- **AAAK-style render at retrieval time** — *only* if vault size ever demands it. Lossy (84.2% R@5 vs. verbatim), not MemPalace's default, and largely redundant with our existing compression via summaries. Store as an opt-in render format, not as the sidecar body.
- **Plugin / extension system.**

---

## 13. Known Open Questions

- **Whether the AI has direct access to the Memory tab view, or only through retrieval** — i.e., can the user ask "what do you know about X?" and have Gemma introspect its own memory store?
- **Exact debounce timings** for autosave + embedding refresh — to be tuned during build.
- **Memory sidecar conflict handling** — current plan: on conflict, re-extract and discard both sides. Needs validation once building.
