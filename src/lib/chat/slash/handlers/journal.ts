// /journal <body> — append (or create) the entry into today's daily note.
//
// Daily note lives at `journal/YYYY-MM-DD.md` (UTC; see paths.ts). Frontmatter
// `type: journal`. Each entry lands as `### HH:MM` under `## Entries`. If the
// heading is missing, we append at the end of file rather than guessing.

import type { Proposal } from '$lib/chat/proposal';
import { dailyNotePath } from '$lib/vault/paths';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';

const ENTRIES_HEADING = '## Entries';

export const journalHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'journal') {
    return { kind: 'error', message: 'journalHandler invoked with non-journal command' };
  }

  const now = context.now();
  const target = dailyNotePath(now);
  const existing = await readOrEmpty(context.vault, target);
  const entry = formatEntry(now, cmd.body);

  let finalContent: string;
  let op: Proposal['op'];
  let summary: string;
  if (existing === '') {
    finalContent = composeFreshDailyNote(now, entry);
    op = 'create';
    summary = `Create ${target}`;
  } else {
    finalContent = appendEntry(existing, entry);
    op = 'append';
    summary = `Append entry to ${target}`;
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target,
    op,
    existingContent: existing,
    finalContent,
    summary,
    sourceTurnId: context.sourceTurnId,
  };
  return { kind: 'proposal', proposal };
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function readOrEmpty(vault: SlashContext['vault'], path: NotePath): Promise<string> {
  try {
    return await vault.readRaw(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return '';
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}

function formatEntry(now: Date, body: string): string {
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');
  return `### ${hh}:${mm}\n\n${body.trimEnd()}\n`;
}

function composeFreshDailyNote(now: Date, entry: string): string {
  const dateLabel = isoDate(now);
  return [
    '---',
    'type: journal',
    `created_at: ${now.toISOString()}`,
    '---',
    '',
    `# ${dateLabel}`,
    '',
    ENTRIES_HEADING,
    '',
    entry.trimEnd(),
    '',
  ].join('\n');
}

function appendEntry(existing: string, entry: string): string {
  // If `## Entries` exists, append the new entry at the end of file (not
  // immediately under the heading). Simpler than splitting the doc, and the
  // heading still groups the chronologically-ordered entries together.
  // If the heading doesn't exist, add it before appending.
  const trimmed = existing.replace(/\s+$/, '');
  if (trimmed.includes(ENTRIES_HEADING)) {
    return `${trimmed}\n\n${entry.trimEnd()}\n`;
  }
  return `${trimmed}\n\n${ENTRIES_HEADING}\n\n${entry.trimEnd()}\n`;
}

function isoDate(now: Date): string {
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
