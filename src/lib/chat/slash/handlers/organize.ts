// /organize @path — ask the LLM to identify discrete extractions worth
// pulling out of a "messy" note (daily journal, inbox dump) and produce
// a proposal card per extraction.
//
// Caches the LLM output to a `.suggestions.json` sidecar keyed by the
// note's content hash. Re-organizing an unchanged note reuses the cached
// suggestions instead of re-running the LLM.
//
// Returns kind: 'proposals' so the chat page renders one card per
// extraction. The user accepts/discards each independently.

import type { Proposal } from '$lib/chat/proposal';
import { hashContent } from '$lib/memory/hash';
import {
  buildOrganizePrompt,
  ORGANIZE_SYSTEM_PROMPT,
  parseOrganizeOutput,
} from '$lib/memory/organize';
import {
  readSuggestions,
  writeSuggestions,
  type Suggestion,
  type SuggestionSidecar,
  SUGGESTIONS_SCHEMA_VERSION,
} from '$lib/memory/suggestions';
import { nextAvailableSlug, notePath, slugify, NOTES_DIR } from '$lib/vault/paths';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';
import type { SlashLlmRunner } from '../llm-runner';

// Re-export under the historic name for back-compat; the real type lives in
// llm-runner.ts so /edit (and future LLM-backed commands) can share it.
export type OrganizeLlmRunner = SlashLlmRunner;

// Caller-provided sidecar vault (read+write). Different shape from the
// SlashContext vault because we also need write access — slash handlers
// are read-only against the dispatch-vault by convention.
export interface OrganizeSidecarVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

let runner: OrganizeLlmRunner | undefined;
let sidecarVault: OrganizeSidecarVault | undefined;

export function configureOrganize(llm: OrganizeLlmRunner, vault: OrganizeSidecarVault): void {
  runner = llm;
  sidecarVault = vault;
}

// Test seam — clears the module-level runners so tests can reconfigure
// freshly per case.
export function resetOrganizeForTest(): void {
  runner = undefined;
  sidecarVault = undefined;
}

export const organizeHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'organize') {
    return { kind: 'error', message: 'organizeHandler invoked with non-organize command' };
  }
  if (runner === undefined || sidecarVault === undefined) {
    return {
      kind: 'error',
      message: '/organize is not configured (call configureOrganize first).',
    };
  }
  if (!runner.modelLoaded()) {
    return {
      kind: 'error',
      message: 'Load a model in Setup before /organize — it needs the LLM to generate suggestions.',
    };
  }

  let content: string;
  try {
    content = await context.vault.readRaw(cmd.target);
  } catch {
    return { kind: 'error', message: `Could not read ${cmd.target}.` };
  }
  if (content.trim() === '') {
    return { kind: 'error', message: `${cmd.target} is empty — nothing to organize.` };
  }

  const sourceHash = await hashContent(content);
  let suggestions = await loadCachedSuggestions(sidecarVault, cmd.target, sourceHash);
  if (suggestions === undefined) {
    try {
      const output = await runner.complete(
        ORGANIZE_SYSTEM_PROMPT,
        buildOrganizePrompt(cmd.target, content),
      );
      suggestions = parseOrganizeOutput(output);
    } catch {
      return { kind: 'error', message: 'LLM call failed — try again in a moment.' };
    }
    if (suggestions.length > 0) {
      const sidecar: SuggestionSidecar = {
        schema_version: SUGGESTIONS_SCHEMA_VERSION,
        source: cmd.target,
        source_hash: sourceHash,
        generated_at: context.now().toISOString(),
        suggestions,
      };
      try {
        await writeSuggestions(sidecarVault, sidecar);
      } catch {
        // Sidecar caching is best-effort; the user still gets the proposals.
      }
    }
  }

  if (suggestions.length === 0) {
    return { kind: 'error', message: `Nothing to extract from ${cmd.target}.` };
  }

  const existingNotes = new Set(await context.vault.listNotes());
  const proposals = suggestions.map((suggestion) =>
    suggestionToProposal(suggestion, cmd.target, existingNotes, context),
  );
  return {
    kind: 'proposals',
    proposals,
    summary: `${String(proposals.length)} suggestion${proposals.length === 1 ? '' : 's'} from ${cmd.target}`,
  };
};

async function loadCachedSuggestions(
  vault: OrganizeSidecarVault,
  notePathArgument: NotePath,
  sourceHash: string,
): Promise<Suggestion[] | undefined> {
  let sidecar: SuggestionSidecar | undefined;
  try {
    sidecar = await readSuggestions(vault, notePathArgument);
  } catch {
    return undefined;
  }
  if (sidecar === undefined) return undefined;
  if (sidecar.source_hash !== sourceHash) return undefined;
  return sidecar.suggestions;
}

function suggestionToProposal(
  suggestion: Suggestion,
  source: NotePath,
  existingNotes: Set<NotePath>,
  context: SlashContext,
): Proposal {
  const baseSlug = slugify(suggestion.title);
  const slug = nextAvailableSlug(baseSlug, (candidate) =>
    existingNotes.has(`${NOTES_DIR}/${candidate}.md`),
  );
  // Reserve the slug so two suggestions in the same batch don't collide.
  existingNotes.add(`${NOTES_DIR}/${slug}.md`);
  const target = notePath(slug);
  const finalContent = composeExtractedNote(suggestion, source, context.now());
  return {
    id: cryptoRandomId(),
    target,
    op: 'create',
    existingContent: '',
    finalContent,
    summary: `${labelForKind(suggestion.kind)}: ${suggestion.title}`,
    sourceTurnId: context.sourceTurnId,
    ...(suggestion.excerpt !== undefined && { note: `From source: "${suggestion.excerpt}"` }),
  };
}

function composeExtractedNote(suggestion: Suggestion, source: NotePath, createdAt: Date): string {
  const lines = [
    '---',
    'type: note',
    `kind: ${suggestion.kind}`,
    `created_at: ${createdAt.toISOString()}`,
    `source: ${source}`,
    '---',
    '',
    `# ${suggestion.title}`,
    '',
    suggestion.content.trimEnd(),
    '',
  ];
  return lines.join('\n');
}

function labelForKind(kind: Suggestion['kind']): string {
  switch (kind) {
    case 'idea': {
      return 'Idea';
    }
    case 'person': {
      return 'Person';
    }
    case 'task': {
      return 'Task';
    }
    case 'fact': {
      return 'Fact';
    }
    case 'list-item': {
      return 'List item';
    }
  }
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
