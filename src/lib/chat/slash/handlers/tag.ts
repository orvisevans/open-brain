// /tag @path <tags…> — merge tags into the note's frontmatter `tags:` list.
// Existing tags are preserved; duplicates are skipped. Tags are stored as
// a flat inline list (`tags: [a, b, c]`) per project frontmatter convention.

import type { Proposal } from '$lib/chat/proposal';
import { addToInlineList } from '$lib/vault/frontmatter-mutate';

import type { DispatchResult, SlashHandler } from '../dispatch';

export const tagHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'tag') {
    return { kind: 'error', message: 'tagHandler invoked with non-tag command' };
  }
  if (cmd.tags.length === 0) {
    return { kind: 'error', message: 'Provide tags: /tag @path <tag1> [tag2…]' };
  }

  let existingContent: string;
  try {
    existingContent = await context.vault.readRaw(cmd.target);
  } catch {
    return { kind: 'error', message: `Could not read ${cmd.target}.` };
  }

  const updated = addToInlineList(existingContent, 'tags', cmd.tags);
  if (!updated.changed) {
    return {
      kind: 'error',
      message: `All requested tags are already on ${cmd.target}.`,
    };
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target: cmd.target,
    op: 'replace',
    existingContent,
    finalContent: updated.content,
    summary: `Tag ${cmd.target} with ${cmd.tags.join(', ')}`,
    sourceTurnId: context.sourceTurnId,
  };
  return { kind: 'proposal', proposal };
};

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
