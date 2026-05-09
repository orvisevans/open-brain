// Daily review prompt — on chat mount, if it's been > 24h since the last
// review AND yesterday's daily journal exists with content, surface a
// banner offering to /organize it. The user clicks the banner; the chat
// page invokes /organize @journal/<yesterday>.md and the proposal cards
// land via the normal pipeline.
//
// State lives at `.openbrain/last-review-at` as a single ISO timestamp.
// File is path-filtered out of the memory pipeline (see notifyMemoryOfChange).

import type { NotePath } from '$lib/vault/types';

export const REVIEW_STATE_PATH: NotePath = '.openbrain/last-review-at';
const REVIEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ReviewVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
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

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
