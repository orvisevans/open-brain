// Public types for the memory layer (sidecars, queues, retrieval inputs).
// See ARCHITECTURE-2026-04-17 §3 for the canonical shape.

import type { NotePath } from '$lib/vault/types';

export const SIDECAR_SCHEMA_VERSION = 1;

export interface Entity {
  type: string;
  name: string;
}

export interface SidecarEmbeddingChunk {
  index: number;
  text: string;
  // 384-dim Float32Array; serialised as base64 in the on-disk sidecar.
  vector: Float32Array;
  // Heading prefix the chunk came from (without `## `), if any.
  heading?: string;
  // Source-body offsets so retrieval can highlight or jump to the snippet
  // location. Both are character offsets into the note body (post-frontmatter).
  start: number;
  end: number;
}

export interface SidecarLink {
  to: string;
  display?: string;
}

// On-disk shape. The serialiser writes `vector` fields as base64 strings; the
// in-memory shape uses Float32Array. Conversion happens in `sidecar-format`.
export interface Sidecar {
  schemaVersion: number;
  source: NotePath;
  sourceHash: string;
  extractedAt: number;
  embeddingModel: string;
  // The LLM that produced summary/entities/facts/topics. Undefined if the LLM
  // extraction queue hasn't run yet (embedding-only sidecars are valid).
  extractionModel?: string;

  embeddings: SidecarEmbeddingChunk[];

  // Optional fields populated by the LLM extraction queue.
  summary?: string;
  entities?: Entity[];
  facts?: string[];
  topics?: string[];
  links?: SidecarLink[];
}

export type SidecarStatus = 'fresh' | 'stale' | 'missing' | 'queued' | 'error';

export interface SidecarSummary {
  source: NotePath;
  status: SidecarStatus;
  // Present when the sidecar exists. Used to surface "extracted 4m ago" in
  // the memory tab.
  extractedAt?: number;
  // True when the sidecar's `extractionModel` field is set — i.e. the LLM
  // extraction has run, not just embedding. Lets the UI surface
  // "summary pending" vs "fully indexed".
  hasLLMExtraction?: boolean;
  // Last error, if status === 'error'.
  error?: string;
}
