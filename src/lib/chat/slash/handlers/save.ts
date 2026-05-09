// /save — capture the last assistant message (or the whole session) into a
// new note under `notes/`. First slash command shipped: zero routing risk
// (always creates a new file, never appends), so it validates the proposal
// card UX before we touch any merge logic.

import type { Proposal } from '$lib/chat/proposal';
import { nextAvailableSlug, notePath, slugify, NOTES_DIR } from '$lib/vault/paths';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';
import type { ParsedCommand } from '../parser';

export const saveHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'save') {
    return { kind: 'error', message: 'saveHandler invoked with non-save command' };
  }

  const captured = collectContent(cmd, context);
  if (captured === undefined) {
    return {
      kind: 'error',
      message: cmd.all
        ? 'No messages in this session yet — nothing to save.'
        : 'No assistant message yet — type something and wait for a reply, then /save.',
    };
  }

  const target = await resolveTarget(cmd, captured.titleHint, context);
  const finalContent = composeNote({
    title: deriveTitle(target, cmd, captured.titleHint),
    body: captured.body,
    sessionId: context.sessionId,
    createdAt: context.now(),
  });

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target,
    op: 'create',
    existingContent: '',
    finalContent,
    summary: `Save to ${target}`,
    sourceTurnId: context.sourceTurnId,
    ...(cmd.all && { note: 'Captures the entire session.' }),
  };
  return { kind: 'proposal', proposal };
};

// ── Helpers ────────────────────────────────────────────────────────────────

interface Captured {
  body: string;
  // Used as a fallback title when the user didn't supply one and didn't
  // override the path. First non-empty line of the captured content,
  // truncated.
  titleHint: string;
}

function collectContent(
  cmd: ParsedCommand & { kind: 'save' },
  context: SlashContext,
): Captured | undefined {
  if (cmd.all) {
    if (context.sessionMessages.length === 0) return undefined;
    const lines: string[] = [];
    for (const message of context.sessionMessages) {
      const role = message.role;
      lines.push(`## ${role}`, '', message.content.trimEnd(), '');
    }
    return {
      body: lines.join('\n').trimEnd(),
      titleHint: 'Saved chat session',
    };
  }
  const last = context.lastAssistantMessage;
  if (last === undefined || last.content.trim() === '') return undefined;
  return {
    body: last.content.trimEnd(),
    titleHint: firstLine(last.content) ?? 'Saved reply',
  };
}

async function resolveTarget(
  cmd: ParsedCommand & { kind: 'save' },
  titleHint: string,
  context: SlashContext,
): Promise<NotePath> {
  if (cmd.target !== undefined) {
    return cmd.target;
  }
  const seedTitle = cmd.title ?? titleHint;
  const baseSlug = slugify(seedTitle);
  const existing = new Set(await context.vault.listNotes());
  const slug = nextAvailableSlug(baseSlug, (candidate) =>
    existing.has(`${NOTES_DIR}/${candidate}.md`),
  );
  return notePath(slug);
}

function deriveTitle(
  target: NotePath,
  cmd: ParsedCommand & { kind: 'save' },
  titleHint: string,
): string {
  if (cmd.title !== undefined && cmd.title !== '') return cmd.title;
  if (titleHint !== '') return titleHint;
  // Last resort: derive from the path itself.
  const stem = target.replace(/^.*\//, '').replace(/\.md$/, '');
  return stem;
}

function composeNote(parameters: {
  title: string;
  body: string;
  sessionId: string;
  createdAt: Date;
}): string {
  const { title, body, sessionId, createdAt } = parameters;
  const frontmatter = [
    '---',
    'type: note',
    `created_at: ${createdAt.toISOString()}`,
    `source_chat: .chats/${sessionId}.md`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}\n# ${title}\n\n${body.trimEnd()}\n`;
}

function firstLine(content: string): string | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    return line.length <= 80 ? line : `${line.slice(0, 77)}…`;
  }
  return undefined;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
