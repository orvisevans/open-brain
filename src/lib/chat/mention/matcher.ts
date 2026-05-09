// Mention matcher — case-insensitive infix search over a list of note paths.
//
// V1 matches against the path only. Frontmatter title/aliases are a v2
// enhancement; reading every file to build a richer index is too expensive
// to spend before measuring real-world miss rates.

import type { NotePath } from '$lib/vault/types';

export interface MentionMatch {
  path: NotePath;
  score: number;
}

const PREFIX_BONUS = 1000;
const INFIX_BONUS = 500;

export function searchMentions(
  paths: readonly NotePath[],
  query: string,
  limit = 8,
): MentionMatch[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') {
    return [...paths]
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit)
      .map((path) => ({ path, score: 0 }));
  }

  const out: MentionMatch[] = [];
  for (const path of paths) {
    const score = scorePath(path, trimmed);
    if (score > 0) out.push({ path, score });
  }
  // Highest score wins; tie-break by shorter path, then alphabetical.
  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path.localeCompare(b.path);
  });
  return out.slice(0, limit);
}

function scorePath(path: NotePath, query: string): number {
  const lowered = path.toLowerCase();
  // The basename is what users typically remember — boost matches there.
  const basename = lowered.slice(lowered.lastIndexOf('/') + 1);
  if (basename.startsWith(query)) return PREFIX_BONUS - lowered.length;
  if (lowered.startsWith(query)) return PREFIX_BONUS - 100 - lowered.length;
  if (basename.includes(query)) return INFIX_BONUS - lowered.length;
  if (lowered.includes(query)) return INFIX_BONUS - 100 - lowered.length;
  return 0;
}
