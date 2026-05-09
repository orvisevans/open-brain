// /list <name> [item] — append to (or create) a list under lists/.
//
// Resolution is deterministic, never LLM-driven:
//   1. Exact filename match.
//   2. Case-insensitive filename match.
//   3. Frontmatter `aliases: [name, ...]` match.
//   4. None of the above → propose creating lists/<slug>.md.
//
// Dedup before append: cheap exact-match first, then embedding-based cosine
// (skip silently with a "looks like a duplicate" message if score > 0.9).
// If the embedder isn't loaded, we skip the embedding pass and accept the
// item — the dedup is a quality-of-life feature, not a correctness gate.

import type { Proposal } from '$lib/chat/proposal';
import { embed } from '$lib/embed';
import { cosine } from '$lib/memory/retrieve';
import { parseFrontmatter } from '$lib/vault/frontmatter';
import { LIST_DIR, listPath } from '$lib/vault/paths';
import type { NotePath } from '$lib/vault/types';

import type { DispatchResult, SlashContext, SlashHandler } from '../dispatch';

const ITEMS_HEADING = '## Items';
const DEDUP_THRESHOLD = 0.9;

export const listHandler: SlashHandler = async (cmd, context): Promise<DispatchResult> => {
  if (cmd.kind !== 'list') {
    return { kind: 'error', message: 'listHandler invoked with non-list command' };
  }

  const resolved = await resolveListTarget(cmd.name, context);
  const existing =
    resolved.path === undefined ? '' : await readOrEmpty(context.vault, resolved.path);
  const target = resolved.path ?? listPath(cmd.name);

  // /list <name> with no item: surface the existing list (error) or propose
  // creating an empty one. Either way, no append.
  if (cmd.item === undefined || cmd.item === '') {
    if (existing !== '') {
      return {
        kind: 'error',
        message: `${target} already exists. Use /list ${cmd.name} <item> to add an entry.`,
      };
    }
    return makeProposal({
      target,
      op: 'create',
      existingContent: '',
      finalContent: composeNewList(cmd.name, []),
      summary: `Create empty list ${target}`,
      sourceTurnId: context.sourceTurnId,
    });
  }

  // Dedup check before composing the proposal.
  if (existing !== '') {
    const duplicate = await findDuplicate(existing, cmd.item);
    if (duplicate !== undefined) {
      return {
        kind: 'error',
        message: `"${cmd.item}" looks like it's already on ${target} (matches "${duplicate}").`,
      };
    }
  }

  if (existing === '') {
    return makeProposal({
      target,
      op: 'create',
      existingContent: '',
      finalContent: composeNewList(cmd.name, [cmd.item]),
      summary: `Create ${target} with first item`,
      sourceTurnId: context.sourceTurnId,
    });
  }

  return makeProposal({
    target,
    op: 'append',
    existingContent: existing,
    finalContent: appendBullet(existing, cmd.item),
    summary: `Append "${cmd.item}" to ${target}`,
    sourceTurnId: context.sourceTurnId,
  });
};

// ── Resolution ─────────────────────────────────────────────────────────────

interface ResolvedTarget {
  // undefined → no existing match; caller proposes creating a fresh file at
  // the slug-derived path.
  path: NotePath | undefined;
}

async function resolveListTarget(name: string, context: SlashContext): Promise<ResolvedTarget> {
  const lowered = name.toLowerCase();
  const exact = listPath(name);
  const all = await context.vault.listNotes();
  const lists = all.filter((path) => path.startsWith(`${LIST_DIR}/`));

  // 1. Exact filename match (after slugify normalization).
  if (lists.includes(exact)) return { path: exact };

  // 2. Case-insensitive filename match.
  const ci = lists.find((path) => path.toLowerCase() === exact.toLowerCase());
  if (ci !== undefined) return { path: ci };

  // 3. Aliases — read each list's frontmatter to look for a matching alias.
  for (const path of lists) {
    let raw: string;
    try {
      raw = await context.vault.readRaw(path);
    } catch {
      continue;
    }
    const { frontmatter } = parseFrontmatter(raw);
    const aliases = frontmatter['aliases'];
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.toLowerCase() === lowered) {
          return { path };
        }
      }
    }
  }

  return { path: undefined };
}

// ── Dedup ──────────────────────────────────────────────────────────────────

async function findDuplicate(existing: string, newItem: string): Promise<string | undefined> {
  const bullets = extractBullets(existing);
  if (bullets.length === 0) return undefined;

  const lower = newItem.toLowerCase().trim();
  const exact = bullets.find((bullet) => bullet.toLowerCase().trim() === lower);
  if (exact !== undefined) return exact;

  // Embedding-based dedup. If the embedder isn't loaded, skip (returns
  // undefined → caller treats as no duplicate).
  let newEmbedding: Float32Array;
  try {
    newEmbedding = await embed(newItem);
  } catch {
    return undefined;
  }

  let bestScore = 0;
  let bestBullet: string | undefined;
  for (const bullet of bullets) {
    let bulletEmbedding: Float32Array;
    try {
      bulletEmbedding = await embed(bullet);
    } catch {
      continue;
    }
    const score = cosine(newEmbedding, bulletEmbedding);
    if (score > bestScore) {
      bestScore = score;
      bestBullet = bullet;
    }
  }
  return bestScore >= DEDUP_THRESHOLD ? bestBullet : undefined;
}

function extractBullets(content: string): string[] {
  const out: string[] = [];
  for (const rawLine of content.split('\n')) {
    const match = /^[-*]\s+(.+)$/.exec(rawLine.trim());
    const captured = match?.[1]?.trim();
    if (captured !== undefined && captured !== '') {
      out.push(captured);
    }
  }
  return out;
}

// ── Composition ────────────────────────────────────────────────────────────

function composeNewList(name: string, items: string[]): string {
  const lines = [
    '---',
    'type: list',
    `name: ${name}`,
    'aliases: []',
    '---',
    '',
    `# ${name}`,
    '',
    ITEMS_HEADING,
    '',
  ];
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  if (items.length > 0) {
    lines.push('');
  }
  return lines.join('\n');
}

function appendBullet(existing: string, item: string): string {
  const trimmed = existing.replace(/\s+$/, '');
  // If `## Items` heading is present, append after the last bullet that
  // follows it. Otherwise append at end of file with the heading added.
  if (trimmed.includes(ITEMS_HEADING)) {
    return `${trimmed}\n- ${item}\n`;
  }
  return `${trimmed}\n\n${ITEMS_HEADING}\n\n- ${item}\n`;
}

// ── Plumbing ───────────────────────────────────────────────────────────────

interface MakeProposalArguments {
  target: NotePath;
  op: Proposal['op'];
  existingContent: string;
  finalContent: string;
  summary: string;
  sourceTurnId: string;
}

function makeProposal(parameters: MakeProposalArguments): DispatchResult {
  return {
    kind: 'proposal',
    proposal: {
      id: cryptoRandomId(),
      target: parameters.target,
      op: parameters.op,
      existingContent: parameters.existingContent,
      finalContent: parameters.finalContent,
      summary: parameters.summary,
      sourceTurnId: parameters.sourceTurnId,
    },
  };
}

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
