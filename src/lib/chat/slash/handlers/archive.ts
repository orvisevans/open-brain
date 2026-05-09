// /archive @path — soft-archive a note by stamping `archived_at` into its
// frontmatter. Reversible (remove the field) and preserves wikilinks (no
// rename). Filtering archived notes out of retrieval is a follow-up — for
// now the marker is informational.

import type { Proposal } from '$lib/chat/proposal';
import { setField } from '$lib/vault/frontmatter-mutate';

import type { DispatchResult, SlashHandler } from '../dispatch';

export const archiveHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'archive') {
    return { kind: 'error', message: 'archiveHandler invoked with non-archive command' };
  }

  let existingContent: string;
  try {
    existingContent = await context.vault.readRaw(cmd.target);
  } catch {
    return { kind: 'error', message: `Could not read ${cmd.target}.` };
  }

  const stamped = setField(existingContent, 'archived_at', context.now().toISOString());
  if (!stamped.changed) {
    return { kind: 'error', message: `${cmd.target} is already archived at the same timestamp.` };
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target: cmd.target,
    op: 'replace',
    existingContent,
    finalContent: stamped.content,
    summary: `Archive ${cmd.target}`,
    sourceTurnId: context.sourceTurnId,
    note: 'Sets archived_at in frontmatter. Reverse by removing the field.',
  };
  return { kind: 'proposal', proposal };
};

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
