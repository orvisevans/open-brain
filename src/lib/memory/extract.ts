// LLM extraction prompt + JSON parsing for memory pipeline.
//
// We ask Gemma for a strict JSON object containing summary/entities/facts/
// topics. Anything else is rejected — the extraction queue will retry next
// pass (or we hand-merge if the LLM is consistently flaky in a way we
// haven't yet diagnosed).

import type { Entity, SidecarLink } from './types';

export interface ExtractionResult {
  summary: string;
  entities: Entity[];
  facts: string[];
  topics: string[];
  links: SidecarLink[];
}

export const EXTRACTION_SYSTEM_PROMPT = [
  'You extract structured information from personal notes.',
  'Return ONLY a JSON object — no prose, no markdown fences.',
  'The JSON object MUST have exactly these keys:',
  '  - summary: string, 1-2 sentences capturing the note',
  '  - entities: array of {type: string, name: string} objects',
  '  - facts: array of short factual statements (strings)',
  '  - topics: array of topic tags (strings, lowercase, single-word when possible)',
  '',
  'Do NOT invent fields. Do NOT include extra commentary. Output JSON only.',
].join('\n');

export function buildExtractionUserPrompt(noteBody: string): string {
  return `Extract structured information from this note:\n\n${noteBody}`;
}

/**
 * Parse the LLM's response into a structured ExtractionResult. Tolerates a
 * surrounding code-fence — some Gemma outputs include `\`\`\`json` despite
 * the system prompt — but rejects anything that doesn't yield a JSON object
 * with the required keys.
 */
export function parseExtractionResponse(raw: string): ExtractionResult {
  const trimmed = raw.trim();
  const stripped = stripCodeFence(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error: unknown) {
    throw new Error(
      `LLM extraction produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LLM extraction did not produce an object');
  }

  const object = parsed as Record<string, unknown>;
  const summary = stringOr(object['summary'], '');
  const entities = entityArray(object['entities']);
  const facts = stringArray(object['facts']);
  const topics = stringArray(object['topics']);
  // `links` is sidecar-derived from wikilinks today; keep it from the
  // extraction input slot for forward-compat.
  const links = linkArray(object['links']);

  return { summary, entities, facts, topics, links };
}

function stripCodeFence(input: string): string {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(input);
  if (fence === null) return input;
  return fence[1] ?? input;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function entityArray(value: unknown): Entity[] {
  if (!Array.isArray(value)) return [];
  const out: Entity[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as { type?: unknown; name?: unknown };
    if (typeof candidate.type !== 'string' || typeof candidate.name !== 'string') continue;
    out.push({ type: candidate.type, name: candidate.name });
  }
  return out;
}

function linkArray(value: unknown): SidecarLink[] {
  if (!Array.isArray(value)) return [];
  const out: SidecarLink[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as { to?: unknown; display?: unknown };
    if (typeof candidate.to !== 'string') continue;
    out.push({
      to: candidate.to,
      ...(typeof candidate.display === 'string' && { display: candidate.display }),
    });
  }
  return out;
}
