// Persona module (Phase 5.9).
//
// Loads, renders, and ensures-default a user-editable persona file at
// `.openbrain/persona.md`. The file is the user's slot to tell the model
// who they are and how to respond. Free-form prose body + optional
// frontmatter shape:
//
//   ---
//   name: Orvis
//   pronouns: he/him
//   tone: terse, direct, no sycophancy
//   focus: [building open-brain, product strategy]
//   ---
//
//   # About me
//
//   <free-form prose>
//
// The frontmatter is rendered into a single-line header in the prompt;
// the body trails after. Total length is capped at PERSONA_CHAR_CAP
// (~250 tokens at 0.3 tok/char). Over-budget content is truncated with
// "…" and a console.warn.
//
// The file lives under `.openbrain/`, which the embedding queue already
// filters out (see src/lib/memory/index.ts notifyMemoryOfChange). It
// rides the same vault → sync pipeline as command-stats.

import { logError } from '$lib/log';
import { parseFrontmatter } from '$lib/vault/frontmatter';
import type { NotePath } from '$lib/vault/types';

export const PERSONA_PATH: NotePath = '.openbrain/persona.md';

// 250 tokens ≈ 1050 chars at 0.3 tok/char. Persona is the only
// user-elastic slot in the system prompt, so cap firmly.
export const PERSONA_CHAR_CAP = 1050;

export interface PersonaFrontmatter {
  name?: string;
  pronouns?: string;
  tone?: string;
  focus?: string[];
}

export interface Persona {
  frontmatter: PersonaFrontmatter;
  body: string;
}

// Empty default written on first run when the file is missing. Short by
// design — every word here would land in the model's context window on
// every turn until the user trims it.
export const PERSONA_STUB = [
  '---',
  'name:',
  'tone:',
  'focus: []',
  '---',
  '',
  '# About me',
  '',
  'This is your personal context file. Edit it to tell the model who you',
  'are, how you want it to respond, and what you tend to think about.',
  'Open Brain includes this in every chat turn — keep it short, every',
  'word counts against your model context window. Leave the body empty',
  '(or delete the file) to opt out.',
  '',
].join('\n');

export interface PersonaReadVault {
  readRaw(path: NotePath): Promise<string>;
}

export interface PersonaWriteVault {
  writeNote(path: NotePath, content: string): Promise<void>;
}

// Loads the persona file. Returns undefined if the file doesn't exist
// or the body is effectively empty (so callers can treat both cases
// the same — no persona slot in the system prompt).
export async function loadPersona(vault: PersonaReadVault): Promise<Persona | undefined> {
  let raw: string;
  try {
    raw = await vault.readRaw(PERSONA_PATH);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    logError('persona/read', { error });
    return undefined;
  }
  const parsed = parseFrontmatter(raw);
  const frontmatter = normaliseFrontmatter(parsed.frontmatter);
  const body = parsed.body.trim();
  if (body === '' && !hasMeaningfulFrontmatter(frontmatter)) {
    return undefined;
  }
  return { frontmatter, body };
}

// Renders the persona for the system prompt. Output starts with a single
// "User: <name> · <tone>" header line (if any of those are set), then the
// trimmed body. Returns undefined when the persona is empty (caller
// should omit the section entirely).
export function renderPersonaForPrompt(persona: Persona | undefined): string | undefined {
  if (persona === undefined) return undefined;
  const headerParts: string[] = [];
  const name = persona.frontmatter.name?.trim();
  if (name !== undefined && name !== '') {
    headerParts.push(`name: ${name}`);
  }
  const pronouns = persona.frontmatter.pronouns?.trim();
  if (pronouns !== undefined && pronouns !== '') {
    headerParts.push(`pronouns: ${pronouns}`);
  }
  const tone = persona.frontmatter.tone?.trim();
  if (tone !== undefined && tone !== '') {
    headerParts.push(`tone: ${tone}`);
  }
  const focus =
    persona.frontmatter.focus === undefined
      ? []
      : persona.frontmatter.focus.filter((f) => f !== '');
  if (focus.length > 0) {
    headerParts.push(`focus: ${focus.join(', ')}`);
  }
  const header = headerParts.length > 0 ? `About the user — ${headerParts.join(' · ')}` : '';
  const body = persona.body.trim();
  const sections = [header, body].filter((section) => section !== '');
  if (sections.length === 0) return undefined;
  const full = sections.join('\n\n');
  return truncate(full);
}

function truncate(text: string): string {
  if (text.length <= PERSONA_CHAR_CAP) return text;
  console.warn(
    `[openbrain/persona] persona is ${String(text.length)} chars, ` +
      `truncating to ${String(PERSONA_CHAR_CAP)}. Trim the file to silence this.`,
  );
  return `${text.slice(0, PERSONA_CHAR_CAP - 1).trimEnd()}…`;
}

// First-run helper. Writes PERSONA_STUB to .openbrain/persona.md when
// the file doesn't exist yet. Caller is responsible for not double-firing
// (e.g. on every layout mount). Safe to call repeatedly — never overwrites.
export async function ensurePersonaStub(
  readVault: PersonaReadVault,
  writeVault: PersonaWriteVault,
): Promise<{ created: boolean }> {
  try {
    await readVault.readRaw(PERSONA_PATH);
    return { created: false };
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      logError('persona/ensure-stub-read', { error });
      return { created: false };
    }
  }
  try {
    await writeVault.writeNote(PERSONA_PATH, PERSONA_STUB);
    return { created: true };
  } catch (error: unknown) {
    logError('persona/ensure-stub-write', { error });
    return { created: false };
  }
}

function normaliseFrontmatter(input: Record<string, unknown>): PersonaFrontmatter {
  const out: PersonaFrontmatter = {};
  const name = input['name'];
  if (typeof name === 'string') out.name = name;
  const pronouns = input['pronouns'];
  if (typeof pronouns === 'string') out.pronouns = pronouns;
  const tone = input['tone'];
  if (typeof tone === 'string') out.tone = tone;
  const focus = input['focus'];
  if (Array.isArray(focus)) {
    out.focus = focus.filter((entry): entry is string => typeof entry === 'string');
  }
  return out;
}

function hasMeaningfulFrontmatter(frontmatter: PersonaFrontmatter): boolean {
  if (isNonEmpty(frontmatter.name)) return true;
  if (isNonEmpty(frontmatter.pronouns)) return true;
  if (isNonEmpty(frontmatter.tone)) return true;
  if (frontmatter.focus?.some((entry) => entry.trim() !== '') === true) return true;
  return false;
}

function isNonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
