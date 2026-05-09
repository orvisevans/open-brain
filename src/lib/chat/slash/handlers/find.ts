// /find <query> — embeddings-only top-N notes ranked by similarity.
// Returns a `'message'` dispatch result so the chat page renders an inline
// list (no proposal card, no LLM turn). Cheap, high-frequency, pure recall.

import { retrieve } from '$lib/memory/retrieve';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashHandler } from '../dispatch';

const TOP_K = 8;

export interface FindRetriever {
  search(query: string, topK: number): Promise<NotePath[]>;
}

let retrieverOverride: FindRetriever | undefined;

export function configureFind(retriever: FindRetriever): void {
  retrieverOverride = retriever;
}

export function resetFindForTest(): void {
  retrieverOverride = undefined;
}

export const findHandler: SlashHandler = async (cmd): Promise<DispatchResult> => {
  if (cmd.kind !== 'find') {
    return { kind: 'error', message: 'findHandler invoked with non-find command' };
  }
  if (cmd.query.trim() === '') {
    return { kind: 'error', message: 'Provide a query: /find <text>' };
  }
  if (retrieverOverride === undefined) {
    return { kind: 'error', message: '/find is not configured.' };
  }

  let results: NotePath[];
  try {
    results = await retrieverOverride.search(cmd.query, TOP_K);
  } catch {
    return {
      kind: 'error',
      message: 'Embedder not ready yet. Try again once Memory has indexed the vault.',
    };
  }

  if (results.length === 0) {
    return { kind: 'message', content: `No matches for "${cmd.query}".` };
  }

  const lines = [
    `Found ${String(results.length)} match${results.length === 1 ? '' : 'es'} for "${cmd.query}":`,
  ];
  for (const path of results) {
    lines.push(`- ${path}`);
  }
  return { kind: 'message', content: lines.join('\n') };
};

export function makeProductionFindRetriever(vault: {
  readRaw: (path: NotePath) => Promise<string>;
  listNotes: () => Promise<NotePath[]>;
}): FindRetriever {
  return {
    search: async (query, topK) => {
      const result = await retrieve(vault, query, { k: topK });
      return result.noteRefs;
    },
  };
}
