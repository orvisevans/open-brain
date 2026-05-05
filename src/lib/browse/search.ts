// Browse-tab search. Online: GitHub code-search via the same-origin
// /__gh_api proxy. Offline (or on API failure): local substring scan over
// the vault.

import { logError } from '$lib/log';
import { vault, type NotePath } from '$lib/vault';

export interface SearchHit {
  path: NotePath;
  // Line of context where the match was found (best-effort; may be the
  // first line of the file when GitHub doesn't return text fragments).
  excerpt?: string;
}

export interface SearchSource {
  source: 'github' | 'local';
}

export type SearchResult = SearchHit[] & SearchSource;

interface GitHubCodeSearchResponse {
  total_count: number;
  items: {
    path: string;
    text_matches?: { fragment: string }[];
  }[];
}

const API_PREFIX = '/__gh_api';

export async function search(
  query: string,
  repo: { owner: string; name: string } | undefined,
  token: string | undefined,
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed === '') return tag([], 'local');

  const canTryGitHub = navigator.onLine && repo !== undefined && token !== undefined;
  if (canTryGitHub) {
    try {
      const hits = await searchGitHub(trimmed, repo, token);
      return tag(hits, 'github');
    } catch (error: unknown) {
      logError('browse/search-github', { error });
      // Fall through to local search.
    }
  }

  const localHits = await searchLocal(trimmed);
  return tag(localHits, 'local');
}

async function searchGitHub(
  query: string,
  repo: { owner: string; name: string },
  token: string,
): Promise<SearchHit[]> {
  const q = encodeURIComponent(`${query} repo:${repo.owner}/${repo.name}`);
  const response = await fetch(`${API_PREFIX}/search/code?q=${q}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      // text-match preview gives us excerpt fragments.
      'Accept': 'application/vnd.github.text-match+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub code search failed: ${String(response.status)} ${response.statusText}`);
  }
  const data = (await response.json()) as GitHubCodeSearchResponse;
  return data.items.map((item) => {
    const fragment = item.text_matches?.[0]?.fragment;
    const hit: SearchHit = { path: item.path };
    if (fragment !== undefined) {
      hit.excerpt = collapseWhitespace(fragment);
    }
    return hit;
  });
}

async function searchLocal(query: string): Promise<SearchHit[]> {
  const lower = query.toLowerCase();
  const paths = await vault.listNotes();
  const hits: SearchHit[] = [];
  for (const path of paths) {
    try {
      const note = await vault.readNote(path);
      const haystack = note.content.toLowerCase();
      const index = haystack.indexOf(lower);
      if (index !== -1) {
        hits.push({ path, excerpt: extractContext(note.content, index, query.length) });
      }
    } catch (error: unknown) {
      logError('browse/search-local', { path, error });
    }
  }
  return hits;
}

function extractContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  const slice = text.slice(start, end);
  return collapseWhitespace(slice);
}

function collapseWhitespace(input: string): string {
  return input.replaceAll(/\s+/g, ' ').trim();
}

function tag(hits: SearchHit[], source: 'github' | 'local'): SearchResult {
  const result = hits as SearchResult;
  result.source = source;
  return result;
}
