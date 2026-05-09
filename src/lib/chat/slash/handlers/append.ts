// /append @path <body> — append free-form content to a specified note.
//
// Refuses to guess the target. Default appends as a new paragraph; --bullet
// appends as a markdown bullet. If the target doesn't exist, propose creating
// it with the body as the initial content.

import type { Proposal } from '$lib/chat/proposal';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';

export const appendHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'append') {
    return { kind: 'error', message: 'appendHandler invoked with non-append command' };
  }
  if (cmd.body === '') {
    return { kind: 'error', message: 'Provide content to append: /append @path <body>' };
  }

  const existing = await readOrEmpty(context.vault, cmd.target);
  const segment = cmd.bullet ? `- ${cmd.body.trimEnd()}\n` : `${cmd.body.trimEnd()}\n`;

  let finalContent: string;
  let op: Proposal['op'];
  let summary: string;
  if (existing === '') {
    finalContent = segment;
    op = 'create';
    summary = `Create ${cmd.target}`;
  } else {
    const trimmed = existing.replace(/\s+$/, '');
    finalContent = `${trimmed}\n\n${segment}`;
    op = 'append';
    summary = `Append to ${cmd.target}`;
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target: cmd.target,
    op,
    existingContent: existing,
    finalContent,
    summary,
    sourceTurnId: context.sourceTurnId,
  };
  return { kind: 'proposal', proposal };
};

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

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
