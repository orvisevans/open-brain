// /edit @path <instruction> — LLM rewrites the file in-place per the user's
// natural-language instruction. Returns a `replace` proposal so the diff
// card surfaces exactly what changed before anything lands. The proposal-
// card guardrail is the same one we built for creates — bad rewrites get
// reviewed and discarded.

import type { Proposal } from '$lib/chat/proposal';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashHandler } from '../dispatch';
import type { SlashLlmRunner } from '../llm-runner';

let runner: SlashLlmRunner | undefined;

export function configureEdit(llm: SlashLlmRunner): void {
  runner = llm;
}

export function resetEditForTest(): void {
  runner = undefined;
}

export const EDIT_SYSTEM_PROMPT = [
  'You are revising a markdown note. The user will provide:',
  '1) the path of the note',
  '2) the current full contents of the note',
  '3) a natural-language instruction describing the change',
  '',
  'Output the FULL revised contents of the note and nothing else.',
  '',
  'Strict rules:',
  '- Preserve everything the user did not ask to change — frontmatter, headings, code blocks, formatting.',
  '- Do not add commentary, explanation, or wrapping fences.',
  '- If the instruction is ambiguous, make the smallest sensible change.',
].join('\n');

export const editHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'edit') {
    return { kind: 'error', message: 'editHandler invoked with non-edit command' };
  }
  if (runner === undefined) {
    return { kind: 'error', message: '/edit is not configured.' };
  }
  if (!runner.modelLoaded()) {
    return {
      kind: 'error',
      message: 'Load a model in Setup before /edit — it needs the LLM to revise the note.',
    };
  }
  if (cmd.instruction.trim() === '') {
    return {
      kind: 'error',
      message: 'Provide an instruction: /edit @path <what to change>',
    };
  }

  let existingContent: string;
  try {
    existingContent = await context.vault.readRaw(cmd.target);
  } catch {
    return { kind: 'error', message: `Could not read ${cmd.target}.` };
  }

  let revised: string;
  try {
    revised = await runner.complete(
      EDIT_SYSTEM_PROMPT,
      buildEditPrompt(cmd.target, existingContent, cmd.instruction),
    );
  } catch {
    return { kind: 'error', message: 'LLM call failed — try again in a moment.' };
  }

  const finalContent = stripWrappingFences(revised);
  if (finalContent.trim() === '') {
    return { kind: 'error', message: 'LLM returned empty content — discarding.' };
  }
  if (finalContent === existingContent) {
    return { kind: 'error', message: `No changes proposed for ${cmd.target}.` };
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target: cmd.target,
    op: 'replace',
    existingContent,
    finalContent,
    summary: `Edit ${cmd.target}`,
    sourceTurnId: context.sourceTurnId,
    note: `Instruction: ${cmd.instruction}`,
  };
  return { kind: 'proposal', proposal };
};

function buildEditPrompt(target: NotePath, content: string, instruction: string): string {
  return [
    `Note path: ${target}`,
    '',
    'Current contents:',
    content,
    '',
    `Instruction: ${instruction}`,
  ].join('\n');
}

// Some models wrap their output in a fenced markdown block (```markdown ...
// ``` or ``` ... ```). Strip a single outer wrapper if present so the diff
// card shows the actual content, not the fence. When no wrapper is present
// the output is returned untouched (preserving trailing newlines).
export function stripWrappingFences(output: string): string {
  const fenceMatch = /^\s*```(?:[a-z]+)?\n([\s\S]*?)\n```\s*$/i.exec(output);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1];
  }
  return output;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
