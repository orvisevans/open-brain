// /find <query> — embeddings-only top-N matches across notes + chats,
// ranked by similarity. Returns a `'message'` dispatch result so the chat
// page renders an inline list (no proposal card, no LLM turn). Cheap,
// high-frequency, pure recall.
//
// Phase 5.7: chats are first-class results. Chat hits render with a chat
// glyph + the user-side snippet so users can see *what* they thought,
// not just *where*.

import { retrieve, type RetrievedChunk } from '$lib/memory/retrieve';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashHandler } from '../dispatch';

const TOP_K = 8;

export interface FindHit {
  path: NotePath;
  source: 'note' | 'chat';
  role?: 'user' | 'assistant' | 'system';
  excerpt?: string;
  messageTimestamp?: number;
}

export interface FindRetriever {
  search(query: string, topK: number): Promise<FindHit[]>;
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

  let hits: FindHit[];
  try {
    hits = await retrieverOverride.search(cmd.query, TOP_K);
  } catch {
    return {
      kind: 'error',
      message: 'Embedder not ready yet. Try again once Memory has indexed the vault.',
    };
  }

  if (hits.length === 0) {
    return { kind: 'message', content: `No matches for "${cmd.query}".` };
  }

  const lines = [
    `Found ${String(hits.length)} match${hits.length === 1 ? '' : 'es'} for "${cmd.query}":`,
  ];
  for (const hit of hits) {
    if (hit.source === 'chat') {
      const role = hit.role === undefined ? '' : ` · ${hit.role}`;
      const excerpt = hit.excerpt === undefined ? '' : ` — ${truncate(hit.excerpt, 80)}`;
      lines.push(`- 💬 ${hit.path}${role}${excerpt}`);
    } else {
      lines.push(`- ${hit.path}`);
    }
  }
  return { kind: 'message', content: lines.join('\n') };
};

function truncate(text: string, max: number): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

export function makeProductionFindRetriever(vault: {
  readRaw: (path: NotePath) => Promise<string>;
  listNotes: () => Promise<NotePath[]>;
  listChats?: () => Promise<NotePath[]>;
}): FindRetriever {
  return {
    search: async (query, topK) => {
      const result = await retrieve(vault, query, { k: topK });
      // Deduplicate by (path, source) keeping the best chunk per source path.
      const seen = new Map<string, RetrievedChunk>();
      for (const chunk of result.chunks) {
        const key = `${chunk.source ?? 'note'}::${chunk.notePath}`;
        if (!seen.has(key)) seen.set(key, chunk);
      }
      return [...seen.values()].map((chunk) => ({
        path: chunk.notePath,
        source: chunk.source ?? 'note',
        ...(chunk.role !== undefined && { role: chunk.role }),
        excerpt: chunk.text,
        ...(chunk.messageTimestamp !== undefined && { messageTimestamp: chunk.messageTimestamp }),
      }));
    },
  };
}
