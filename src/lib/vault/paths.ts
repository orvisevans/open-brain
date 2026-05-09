// Vault path conventions for Phase 5.5 conversational note ops.
//
// All functions are pure — no fs access. NotePath is repo-relative POSIX.
// Slash-command handlers compose these to land files in the right place
// without baking directory names into every handler.

import type { NotePath } from './types';

export const JOURNAL_DIR = 'journal';
export const LIST_DIR = 'lists';
export const NOTES_DIR = 'notes';

export function dailyNotePath(date: Date): NotePath {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${JOURNAL_DIR}/${year}-${month}-${day}.md`;
}

export function listPath(name: string): NotePath {
  return `${LIST_DIR}/${slugify(name)}.md`;
}

export function notePath(slug: string): NotePath {
  return `${NOTES_DIR}/${slug}.md`;
}

// Slugify a free-form title to a filesystem-safe filename stem.
// - NFD-normalises and strips combining marks so "café" → "cafe", "über" → "uber"
// - lowercases
// - replaces non-alphanumeric runs with a single hyphen
// - trims leading/trailing hyphens
// - empty / non-Latin-only input → 'untitled'
// - max length 80, preferring to break at the last hyphen above 40 chars
export function slugify(input: string): string {
  const decomposed = input.normalize('NFD').replaceAll(/\p{Mn}/gu, '');
  const lowered = decomposed.toLowerCase();
  const replaced = lowered.replaceAll(/[^a-z0-9]+/g, '-');
  const trimmed = replaced.replaceAll(/^-+|-+$/g, '');
  if (trimmed === '') return 'untitled';
  if (trimmed.length <= 80) return trimmed;
  const cut = trimmed.slice(0, 80);
  const lastHyphen = cut.lastIndexOf('-');
  return lastHyphen > 40 ? cut.slice(0, lastHyphen) : cut;
}

// Find the next slug that doesn't collide with `exists`. Caller wires
// `exists` to membership in `vault.listNotes()`.
export function nextAvailableSlug(slug: string, exists: (slug: string) => boolean): string {
  if (!exists(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${String(n)}`;
    if (!exists(candidate)) return candidate;
  }
  return `${slug}-${String(Date.now())}`;
}
