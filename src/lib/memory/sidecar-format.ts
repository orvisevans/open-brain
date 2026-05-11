// Sidecar serialisation/deserialisation.
//
// On-disk format (machine-only, not user-edited):
//
//   ---
//   schema_version: 1
//   source: notes/foo.md
//   source_hash: <hex>
//   extracted_at: <ms-epoch>
//   embedding_model: Xenova/all-MiniLM-L6-v2
//   extraction_model: gemma-2-2b-it-q4f16_1-MLC      # optional
//   ---
//
//   ```json
//   { "embeddings": [...], "summary": "...", ... }
//   ```
//
// We parse the frontmatter ourselves (the shared frontmatter parser in
// `$lib/vault/frontmatter` doesn't carry round-trip fidelity for our needs),
// and the body is a JSON code block holding the bulk of the sidecar
// (embeddings + LLM extraction output). Embedding vectors are base64-encoded
// `Float32Array.buffer` blobs.

import type { NotePath } from '$lib/vault/types';

import type { Sidecar, SidecarEmbeddingChunk } from './types';
import { SIDECAR_SCHEMA_VERSION } from './types';

// Embedding model id is identical to `EMBEDDING_MODEL_ID` from `$lib/embed`,
// but importing from there inside this module would form a memory→embed
// import cycle (queues import both). Inline the constant.
export const SIDECAR_FILE_PREFIX = '.memory/';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const JSON_BLOCK_RE = /```json\r?\n([\s\S]*?)\r?\n```/;

interface SidecarBody {
  embeddings: {
    index: number;
    text: string;
    vector: string; // base64
    heading?: string;
    start: number;
    end: number;
    // Phase 5.7: chat-source chunks carry per-message metadata.
    role?: 'user' | 'assistant' | 'system';
    messageIndex?: number;
    messageTimestamp?: number;
  }[];
  summary?: string;
  entities?: { type: string; name: string }[];
  facts?: string[];
  topics?: string[];
  links?: { to: string; display?: string }[];
}

export function noteToSidecarPath(notePath: NotePath): NotePath {
  return `${SIDECAR_FILE_PREFIX}${notePath}`;
}

export function sidecarToNotePath(sidecarPath: NotePath): NotePath | undefined {
  if (!sidecarPath.startsWith(SIDECAR_FILE_PREFIX)) return undefined;
  return sidecarPath.slice(SIDECAR_FILE_PREFIX.length);
}

export function isSidecarPath(path: NotePath): boolean {
  return path.startsWith(SIDECAR_FILE_PREFIX);
}

export function serializeSidecar(sidecar: Sidecar): string {
  const frontLines = [
    '---',
    `schema_version: ${String(sidecar.schemaVersion)}`,
    `source: ${escapeFrontmatterValue(sidecar.source)}`,
    `source_hash: ${sidecar.sourceHash}`,
    `extracted_at: ${String(sidecar.extractedAt)}`,
    `embedding_model: ${escapeFrontmatterValue(sidecar.embeddingModel)}`,
  ];
  if (sidecar.extractionModel !== undefined) {
    frontLines.push(`extraction_model: ${escapeFrontmatterValue(sidecar.extractionModel)}`);
  }
  frontLines.push('---', '');

  const body: SidecarBody = {
    embeddings: sidecar.embeddings.map((chunk) => ({
      index: chunk.index,
      text: chunk.text,
      vector: encodeFloat32(chunk.vector),
      ...(chunk.heading !== undefined && { heading: chunk.heading }),
      start: chunk.start,
      end: chunk.end,
      ...(chunk.role !== undefined && { role: chunk.role }),
      ...(chunk.messageIndex !== undefined && { messageIndex: chunk.messageIndex }),
      ...(chunk.messageTimestamp !== undefined && { messageTimestamp: chunk.messageTimestamp }),
    })),
    ...(sidecar.summary !== undefined && { summary: sidecar.summary }),
    ...(sidecar.entities !== undefined && { entities: sidecar.entities }),
    ...(sidecar.facts !== undefined && { facts: sidecar.facts }),
    ...(sidecar.topics !== undefined && { topics: sidecar.topics }),
    ...(sidecar.links !== undefined && { links: sidecar.links }),
  };

  // Pretty-print for human inspectability when debugging. The bulk of the
  // file is base64 vectors anyway; the indentation is a rounding error.
  const json = JSON.stringify(body, undefined, 2);
  return `${frontLines.join('\n')}\n\`\`\`json\n${json}\n\`\`\`\n`;
}

export class SidecarParseError extends Error {
  override readonly name = 'SidecarParseError';
}

export function parseSidecar(content: string): Sidecar {
  const front = FRONTMATTER_RE.exec(content);
  if (front === null) {
    throw new SidecarParseError('missing frontmatter');
  }
  const frontmatter = parseFrontLines(front[1] ?? '');

  const schemaVersion = numberField(frontmatter, 'schema_version');
  const source = stringField(frontmatter, 'source');
  const sourceHash = stringField(frontmatter, 'source_hash');
  const extractedAt = numberField(frontmatter, 'extracted_at');
  const embeddingModel = stringField(frontmatter, 'embedding_model');
  const extractionModel = optionalStringField(frontmatter, 'extraction_model');

  const bodyMatch = JSON_BLOCK_RE.exec(content.slice(front[0].length));
  if (bodyMatch === null) {
    throw new SidecarParseError('missing JSON body');
  }
  let body: SidecarBody;
  try {
    body = JSON.parse(bodyMatch[1] ?? '{}') as SidecarBody;
  } catch (error: unknown) {
    throw new SidecarParseError(
      `invalid JSON body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const embeddings: SidecarEmbeddingChunk[] = body.embeddings.map((entry) => ({
    index: entry.index,
    text: entry.text,
    vector: decodeFloat32(entry.vector),
    ...(entry.heading !== undefined && { heading: entry.heading }),
    start: entry.start,
    end: entry.end,
    ...(entry.role !== undefined && { role: entry.role }),
    ...(entry.messageIndex !== undefined && { messageIndex: entry.messageIndex }),
    ...(entry.messageTimestamp !== undefined && { messageTimestamp: entry.messageTimestamp }),
  }));

  return {
    schemaVersion,
    source,
    sourceHash,
    extractedAt,
    embeddingModel,
    ...(extractionModel !== undefined && { extractionModel }),
    embeddings,
    ...(body.summary !== undefined && { summary: body.summary }),
    ...(body.entities !== undefined && { entities: body.entities }),
    ...(body.facts !== undefined && { facts: body.facts }),
    ...(body.topics !== undefined && { topics: body.topics }),
    ...(body.links !== undefined && { links: body.links }),
  };
}

export function isCurrentSchema(sidecar: Sidecar): boolean {
  return sidecar.schemaVersion === SIDECAR_SCHEMA_VERSION;
}

// Parses lines of the form `key: value`. We tolerate leading/trailing
// whitespace and ignore blank lines + comments. Strings keep their literal
// content (sans surrounding double quotes if present).
function parseFrontLines(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function stringField(frontmatter: Record<string, string>, key: string): string {
  const value = frontmatter[key];
  if (value === undefined || value === '') {
    throw new SidecarParseError(`missing required frontmatter field: ${key}`);
  }
  return value;
}

function optionalStringField(frontmatter: Record<string, string>, key: string): string | undefined {
  const value = frontmatter[key];
  if (value === undefined || value === '') return undefined;
  return value;
}

function numberField(frontmatter: Record<string, string>, key: string): number {
  const raw = stringField(frontmatter, key);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new SidecarParseError(`field ${key} is not a finite number: ${raw}`);
  }
  return parsed;
}

function escapeFrontmatterValue(value: string): string {
  // Quote if the value contains characters that would confuse the line-based
  // parser (currently just newlines or wrapping whitespace). Most paths and
  // model ids are safe.
  if (/[\n\r]/.test(value) || value !== value.trim() || value.includes(':')) {
    return JSON.stringify(value);
  }
  return value;
}

function encodeFloat32(vector: Float32Array): string {
  // Encode the underlying ArrayBuffer as base64. Using btoa over a binary
  // string keeps the implementation portable across browsers and Node.
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  // `btoa` exists on both browser globals and Node 16+ globals.
  return globalThis.btoa(binary);
}

function decodeFloat32(base64: string): Float32Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  // Ensure 4-byte alignment in case the underlying buffer is shifted.
  // `bytes.buffer` has byteOffset 0 here, so this slice is a no-op copy that
  // guarantees alignment for the Float32Array view.
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}
