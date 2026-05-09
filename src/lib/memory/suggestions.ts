// Suggestion sidecars — pre-computed organize proposals for "messy" notes
// (daily journals, inbox dumps). Mirrors the embedding sidecar shape and
// path convention so the existing memory pipeline ignores it consistently.
//
// On-disk path: `.memory/<note-path>.suggestions.json`. Caller writes when
// the LLM has produced suggestions for a note; reader returns undefined when
// missing. Cache key is the source content hash — when the note's content
// changes, the cached suggestions are stale and the caller should regenerate.

import type { NotePath } from '$lib/vault/types';

export const SUGGESTIONS_SCHEMA_VERSION = 1;

export type SuggestionKind = 'idea' | 'person' | 'task' | 'fact' | 'list-item';

export interface Suggestion {
  kind: SuggestionKind;
  // Title for the proposed extraction. Shown in the proposal card header.
  title: string;
  // Full markdown content for the proposed file or list entry.
  content: string;
  // Optional excerpt from the source (a quote-style anchor) — useful for
  // the proposal card so the user sees why this was suggested.
  excerpt?: string;
}

export interface SuggestionSidecar {
  schema_version: number;
  source: NotePath;
  source_hash: string;
  generated_at: string;
  suggestions: Suggestion[];
}

export interface SuggestionsVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

export function suggestionsPathFor(notePath: NotePath): NotePath {
  return `.memory/${notePath}.suggestions.json`;
}

export async function readSuggestions(
  vault: SuggestionsVault,
  notePath: NotePath,
): Promise<SuggestionSidecar | undefined> {
  const path = suggestionsPathFor(notePath);
  let raw: string;
  try {
    raw = await vault.readRaw(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  return parseSidecar(raw);
}

export async function writeSuggestions(
  vault: SuggestionsVault,
  sidecar: SuggestionSidecar,
): Promise<void> {
  const path = suggestionsPathFor(sidecar.source);
  await vault.writeNote(path, JSON.stringify(sidecar, undefined, 2));
}

function parseSidecar(raw: string): SuggestionSidecar | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = value as {
      schema_version?: unknown;
      source?: unknown;
      source_hash?: unknown;
      generated_at?: unknown;
      suggestions?: unknown;
    };
    if (
      candidate.schema_version !== SUGGESTIONS_SCHEMA_VERSION ||
      typeof candidate.source !== 'string' ||
      typeof candidate.source_hash !== 'string' ||
      typeof candidate.generated_at !== 'string' ||
      !Array.isArray(candidate.suggestions)
    ) {
      return undefined;
    }
    const suggestions: Suggestion[] = [];
    for (const entry of candidate.suggestions) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as {
        kind?: unknown;
        title?: unknown;
        content?: unknown;
        excerpt?: unknown;
      };
      if (
        typeof item.kind !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.content !== 'string'
      ) {
        continue;
      }
      const suggestion: Suggestion = {
        kind: item.kind as SuggestionKind,
        title: item.title,
        content: item.content,
        ...(typeof item.excerpt === 'string' && { excerpt: item.excerpt }),
      };
      suggestions.push(suggestion);
    }
    return {
      schema_version: candidate.schema_version,
      source: candidate.source,
      source_hash: candidate.source_hash,
      generated_at: candidate.generated_at,
      suggestions,
    };
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
