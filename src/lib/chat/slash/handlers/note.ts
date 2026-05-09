// /note <title> — create a new free-form note under notes/.
//
// Validates the create-with-explicit-title path: no session history needed,
// no merge logic, just slug → path → propose.

import type { Proposal } from '$lib/chat/proposal';
import { nextAvailableSlug, notePath, slugify, NOTES_DIR } from '$lib/vault/paths';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';

export const noteHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'note') {
    return { kind: 'error', message: 'noteHandler invoked with non-note command' };
  }

  const target = await resolveTarget(cmd.title, context);
  const finalContent = composeNote({
    title: cmd.title,
    createdAt: context.now(),
    ...(cmd.body !== undefined && { body: cmd.body }),
    ...(cmd.tags !== undefined && cmd.tags.length > 0 && { tags: cmd.tags }),
  });

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target,
    op: 'create',
    existingContent: '',
    finalContent,
    summary: `Create ${target}`,
    sourceTurnId: context.sourceTurnId,
  };
  return { kind: 'proposal', proposal };
};

async function resolveTarget(title: string, context: SlashContext): Promise<NotePath> {
  const baseSlug = slugify(title);
  const existing = new Set(await context.vault.listNotes());
  const slug = nextAvailableSlug(baseSlug, (candidate) =>
    existing.has(`${NOTES_DIR}/${candidate}.md`),
  );
  return notePath(slug);
}

function composeNote(parameters: {
  title: string;
  body?: string;
  tags?: string[];
  createdAt: Date;
}): string {
  const { title, body, tags, createdAt } = parameters;
  const lines = ['---', 'type: note', `created_at: ${createdAt.toISOString()}`];
  if (tags !== undefined && tags.length > 0) {
    lines.push(`tags: [${tags.join(', ')}]`);
  }
  lines.push('---', '', `# ${title}`, '');
  if (body !== undefined && body !== '') {
    lines.push(body.trimEnd(), '');
  }
  return lines.join('\n');
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
