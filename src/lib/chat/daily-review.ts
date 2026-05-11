// Daily review prompt — on chat mount, if it's been > 24h since the last
// review AND yesterday's daily journal exists with content, surface a
// banner offering to /organize it. The user clicks the banner; the chat
// page invokes /organize @journal/<yesterday>.md and the proposal cards
// land via the normal pipeline.
//
// Phase 5.8: also surfaces cumulative fresh suggestion sidecars across the
// vault so a chat-heavy day where auto-organize wrote suggestions for
// `.chats/<id>.md` files still gets reviewed — yesterday's journal isn't
// the only valid trigger anymore.
//
// State lives at `.openbrain/last-review-at` as a single ISO timestamp.
// File is path-filtered out of the memory pipeline (see notifyMemoryOfChange).

import type { NotePath } from '$lib/vault/types';

export const REVIEW_STATE_PATH: NotePath = '.openbrain/last-review-at';
const REVIEW_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUGGESTIONS_SUFFIX = '.suggestions.json';
const SUGGESTIONS_PREFIX = '.memory/';

export interface ReviewVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

export interface SuggestionCountVault extends ReviewVault {
  // Returns every `.memory/*.suggestions.json` path. Phase 5.8 uses this
  // to count fresh suggestion sidecars across notes + chats.
  listSuggestionPaths?(): Promise<NotePath[]>;
}

export async function loadLastReviewAt(vault: ReviewVault): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await vault.readRaw(REVIEW_STATE_PATH);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function recordReview(vault: ReviewVault, now: Date): Promise<void> {
  await vault.writeNote(REVIEW_STATE_PATH, now.toISOString());
}

export function isReviewDue(lastReviewAt: number | undefined, now: number): boolean {
  if (lastReviewAt === undefined) return true;
  return now - lastReviewAt >= REVIEW_INTERVAL_MS;
}

export function yesterdayJournalPath(now: Date): NotePath {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const year = yesterday.getUTCFullYear().toString().padStart(4, '0');
  const month = (yesterday.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = yesterday.getUTCDate().toString().padStart(2, '0');
  return `journal/${year}-${month}-${day}.md`;
}

export async function yesterdayHasContent(
  vault: ReviewVault,
  now: Date,
): Promise<{ path: NotePath; hasContent: boolean }> {
  const path = yesterdayJournalPath(now);
  try {
    const content = await vault.readRaw(path);
    return { path, hasContent: content.trim().length > 100 };
  } catch (error: unknown) {
    if (isNotFound(error)) return { path, hasContent: false };
    throw error;
  }
}

export interface ReviewSummary {
  // Total suggestions across all sidecars whose source was touched after
  // the last review.
  freshSuggestionCount: number;
  // Distinct source paths contributing fresh suggestions (e.g.
  // `journal/2026-05-11.md`, `.chats/2026-05-11_x.md`).
  freshSources: NotePath[];
}

// Phase 5.8: returns the cumulative count of suggestions sitting in
// `.memory/*.suggestions.json` whose `generated_at` is strictly after
// `lastReviewAt`. Vault must implement `listSuggestionPaths` — if missing,
// the count is zero (graceful for tests that pass a minimal review vault).
// Omitting `lastReviewAt` treats every sidecar as fresh.
export async function summariseFreshSuggestions(
  vault: SuggestionCountVault,
  lastReviewAt?: number,
): Promise<ReviewSummary> {
  if (vault.listSuggestionPaths === undefined) {
    return { freshSuggestionCount: 0, freshSources: [] };
  }
  let paths: NotePath[];
  try {
    paths = await vault.listSuggestionPaths();
  } catch {
    return { freshSuggestionCount: 0, freshSources: [] };
  }
  const cutoff = lastReviewAt ?? 0;
  let count = 0;
  const sources: NotePath[] = [];
  for (const path of paths) {
    if (!path.startsWith(SUGGESTIONS_PREFIX) || !path.endsWith(SUGGESTIONS_SUFFIX)) continue;
    let raw: string;
    try {
      raw = await vault.readRaw(path);
    } catch {
      continue;
    }
    const parsed = parseSuggestionSummary(raw);
    if (parsed === undefined) continue;
    if (parsed.generatedAtMs <= cutoff) continue;
    if (parsed.suggestionCount === 0) continue;
    count += parsed.suggestionCount;
    sources.push(parsed.source);
  }
  return { freshSuggestionCount: count, freshSources: sources };
}

interface ParsedSuggestionSummary {
  source: NotePath;
  generatedAtMs: number;
  suggestionCount: number;
}

function parseSuggestionSummary(raw: string): ParsedSuggestionSummary | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = value as {
      source?: unknown;
      generated_at?: unknown;
      suggestions?: unknown;
    };
    if (
      typeof candidate.source !== 'string' ||
      typeof candidate.generated_at !== 'string' ||
      !Array.isArray(candidate.suggestions)
    ) {
      return undefined;
    }
    const generatedAtMs = Date.parse(candidate.generated_at);
    if (!Number.isFinite(generatedAtMs)) return undefined;
    return {
      source: candidate.source,
      generatedAtMs,
      suggestionCount: candidate.suggestions.length,
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
