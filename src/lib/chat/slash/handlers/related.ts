// /related @path — find semantically similar notes and propose a `## See Also`
// section with bullet links. Embeddings-only — no LLM call. Reuses the
// existing memory retrieval pipeline (Phase 4 vectors).

import type { Proposal } from '$lib/chat/proposal';
import { retrieve } from '$lib/memory/retrieve';
import { parseFrontmatter } from '$lib/vault/frontmatter';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashHandler } from '../dispatch';

const SEE_ALSO_HEADING = '## See Also';
const TOP_K = 5;
// We embed the body, not the whole file, to avoid frontmatter dominating the
// signal for very small notes.
const QUERY_BODY_CHAR_LIMIT = 1200;

export interface RelatedRetriever {
  findRelated(sourcePath: NotePath, query: string, topK: number): Promise<NotePath[]>;
}

let retrieverOverride: RelatedRetriever | undefined;

// Test seam: install a fake retriever so tests don't need to spin up the
// embedding pipeline. Pass nothing (or undefined) to clear.
export function configureRelatedForTest(retriever?: RelatedRetriever): void {
  retrieverOverride = retriever;
}

export const relatedHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'related') {
    return { kind: 'error', message: 'relatedHandler invoked with non-related command' };
  }

  let existingContent: string;
  try {
    existingContent = await context.vault.readRaw(cmd.target);
  } catch {
    return { kind: 'error', message: `Could not read ${cmd.target}.` };
  }

  const { body } = parseFrontmatter(existingContent);
  const query = body.trim().slice(0, QUERY_BODY_CHAR_LIMIT);
  if (query === '') {
    return { kind: 'error', message: `${cmd.target} has no body content to compare.` };
  }

  if (retrieverOverride === undefined) {
    return { kind: 'error', message: '/related is not configured.' };
  }
  let related: NotePath[];
  try {
    related = await retrieverOverride.findRelated(cmd.target, query, TOP_K);
  } catch {
    return {
      kind: 'error',
      message: 'Embedder not ready yet. Try again once Memory has indexed the vault.',
    };
  }

  if (related.length === 0) {
    return { kind: 'error', message: `No related notes found for ${cmd.target}.` };
  }

  const finalContent = applyRelatedSection(existingContent, related);
  if (finalContent === existingContent) {
    return { kind: 'error', message: `## See Also already lists those notes.` };
  }

  const proposal: Proposal = {
    id: cryptoRandomId(),
    target: cmd.target,
    op: 'replace',
    existingContent,
    finalContent,
    summary: `Add See Also to ${cmd.target}`,
    sourceTurnId: context.sourceTurnId,
    note: `${String(related.length)} related notes by embedding similarity.`,
  };
  return { kind: 'proposal', proposal };
};

// Apply the See Also section: replace any existing one, or append after the
// note's body (and any trailing blank lines).
export function applyRelatedSection(existing: string, related: readonly NotePath[]): string {
  const bullets = related.map((path) => `- [[${path}]]`).join('\n');
  const newSection = `${SEE_ALSO_HEADING}\n\n${bullets}\n`;

  // Detect existing See Also block (heading line + lines until next ## heading
  // or end of file).
  const headingIndex = existing.indexOf(SEE_ALSO_HEADING);
  if (headingIndex !== -1) {
    const before = existing.slice(0, headingIndex);
    const afterHeading = existing.slice(headingIndex + SEE_ALSO_HEADING.length);
    const nextHeadingMatch = /\n##\s/.exec(afterHeading);
    const after = nextHeadingMatch === null ? '' : afterHeading.slice(nextHeadingMatch.index + 1);
    const trimmedBefore = before.replace(/\s+$/, '');
    return `${trimmedBefore}\n\n${newSection}${after === '' ? '' : `\n${after}`}`;
  }

  const trimmed = existing.replace(/\s+$/, '');
  return `${trimmed}\n\n${newSection}`;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Production-side wiring: a thin adapter that wraps the project's `retrieve`
// function so the handler doesn't have to import `vault` directly. The
// chat page calls `configureRelated(buildRetriever(vault))` at mount.
export function makeProductionRetriever(vault: {
  readRaw: (path: NotePath) => Promise<string>;
  listNotes: () => Promise<NotePath[]>;
}): RelatedRetriever {
  return {
    findRelated: async (sourcePath, query, topK) => {
      const result = await retrieve(vault, query, { k: topK + 5 });
      return result.noteRefs.filter((path) => path !== sourcePath).slice(0, topK);
    },
  };
}

export function configureRelated(retriever: RelatedRetriever): void {
  retrieverOverride = retriever;
}
