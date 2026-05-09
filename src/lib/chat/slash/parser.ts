// Slash-command parser for Phase 5.5 conversational note ops.
//
// Same parser is used for both **user input** (typed in the chat box) and
// **LLM output** (when the model emits a slash command from natural language).
// Single source of truth; no separate code path for the LLM.
//
// Recognized commands: /save, /journal, /note, /append, /list. Unrecognized
// slashes resolve to `{ kind: 'unknown', raw }` so the UI can show feedback
// rather than the parser throwing.

import type { NotePath } from '$lib/vault/types';

export type ParsedCommand =
  | { kind: 'save'; all: boolean; target?: NotePath; title?: string }
  | { kind: 'journal'; body: string }
  | { kind: 'note'; title: string; body?: string; tags?: string[] }
  | { kind: 'list'; name: string; item?: string }
  | { kind: 'append'; target: NotePath; body: string; bullet: boolean }
  | { kind: 'organize'; target: NotePath }
  | { kind: 'unknown'; raw: string };

export function parseSlashCommand(input: string): ParsedCommand | undefined {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return undefined;
  const afterSlash = trimmed.slice(1);
  const firstWhitespace = afterSlash.search(/\s/);
  const cmd = (firstWhitespace === -1 ? afterSlash : afterSlash.slice(0, firstWhitespace))
    .toLowerCase()
    .trim();
  const argumentsRaw =
    firstWhitespace === -1 ? '' : afterSlash.slice(firstWhitespace).replace(/^\s+/, '');

  switch (cmd) {
    case 'save': {
      return parseSave(argumentsRaw);
    }
    case 'journal': {
      return parseJournal(argumentsRaw);
    }
    case 'note': {
      return parseNote(argumentsRaw);
    }
    case 'list': {
      return parseList(argumentsRaw);
    }
    case 'append': {
      return parseAppend(argumentsRaw);
    }
    case 'organize': {
      return parseOrganize(argumentsRaw, trimmed);
    }
    case '': {
      return { kind: 'unknown', raw: trimmed };
    }
    default: {
      return { kind: 'unknown', raw: trimmed };
    }
  }
}

// ── Per-command parsers ────────────────────────────────────────────────────

function parseSave(arguments_: string): ParsedCommand {
  let remaining = arguments_;
  const all = MATCH_ALL_FLAG.test(remaining);
  remaining = remaining.replaceAll(MATCH_ALL_FLAG_GLOBAL, ' ');

  const targetMatch = MATCH_AT_TOKEN.exec(remaining);
  let target: NotePath | undefined;
  if (targetMatch !== null) {
    target = mentionToPath(targetMatch[1] ?? '');
    remaining = remaining.replace(targetMatch[0], ' ');
  }

  const title = remaining.trim();
  return {
    kind: 'save',
    all,
    ...(target !== undefined && { target }),
    ...(title !== '' && { title }),
  };
}

function parseJournal(arguments_: string): ParsedCommand {
  if (arguments_.trim() === '') {
    return { kind: 'unknown', raw: '/journal' };
  }
  return { kind: 'journal', body: arguments_ };
}

function parseNote(arguments_: string): ParsedCommand {
  if (arguments_.trim() === '') {
    return { kind: 'unknown', raw: '/note' };
  }
  const newlineIndex = arguments_.indexOf('\n');
  const titleLine = newlineIndex === -1 ? arguments_ : arguments_.slice(0, newlineIndex);
  const bodyRaw = newlineIndex === -1 ? '' : arguments_.slice(newlineIndex + 1).replace(/^\s+/, '');

  // Extract inline #hashtags from the title line, leaving them out of the title.
  const tags: string[] = [];
  const titleWithoutTags = titleLine
    .replaceAll(/(?:^|\s)#([\w-]+)/g, (_match, tag: string) => {
      tags.push(tag);
      return '';
    })
    .trim();

  if (titleWithoutTags === '') {
    return { kind: 'unknown', raw: '/note' };
  }

  return {
    kind: 'note',
    title: titleWithoutTags,
    ...(bodyRaw !== '' && { body: bodyRaw }),
    ...(tags.length > 0 && { tags }),
  };
}

function parseList(arguments_: string): ParsedCommand {
  const trimmed = arguments_.trim();
  if (trimmed === '') {
    return { kind: 'unknown', raw: '/list' };
  }
  // Newline form: name on first line, item is the rest. Useful for multi-line items.
  const newlineIndex = trimmed.indexOf('\n');
  if (newlineIndex !== -1) {
    const name = trimmed.slice(0, newlineIndex).trim();
    const item = trimmed.slice(newlineIndex + 1).trim();
    return name === ''
      ? { kind: 'unknown', raw: '/list' }
      : { kind: 'list', name, ...(item !== '' && { item }) };
  }
  // Single-line: first whitespace-delimited token is the name; rest is the item.
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) {
    return { kind: 'list', name: trimmed };
  }
  return {
    kind: 'list',
    name: trimmed.slice(0, firstSpace),
    item: trimmed.slice(firstSpace + 1).trim(),
  };
}

function parseOrganize(arguments_: string, trimmed: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return { kind: 'unknown', raw: trimmed };
  }
  return { kind: 'organize', target: mentionToPath(targetMatch[1] ?? '') };
}

function parseAppend(arguments_: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return { kind: 'unknown', raw: `/append${arguments_ === '' ? '' : ` ${arguments_}`}` };
  }
  const target = mentionToPath(targetMatch[1] ?? '');
  let remaining = arguments_.replace(targetMatch[0], ' ');
  const bullet = MATCH_BULLET_FLAG.test(remaining);
  remaining = remaining.replaceAll(MATCH_BULLET_FLAG_GLOBAL, ' ');
  const body = remaining.trim();
  return { kind: 'append', target, body, bullet };
}

// ── @-mention → NotePath ────────────────────────────────────────────────────

// `@notes/foo`        → notes/foo.md
// `@notes/foo.md`     → notes/foo.md (idempotent)
// `@grocery`          → notes/grocery.md (no slash → default to notes/)
// `@lists/grocery`    → lists/grocery.md
function mentionToPath(token: string): NotePath {
  const stripped = token.startsWith('@') ? token.slice(1) : token;
  const ensured = stripped.endsWith('.md') ? stripped : `${stripped}.md`;
  return ensured.includes('/') ? ensured : `notes/${ensured}`;
}

// ── Regex constants ────────────────────────────────────────────────────────
//
// We capture `--flag` only when surrounded by whitespace or anchored to a word
// boundary so `--all` inside a longer token doesn't trigger.

const MATCH_ALL_FLAG = /(?:^|\s)--all(?=\s|$)/;
const MATCH_ALL_FLAG_GLOBAL = /(?:^|\s)--all(?=\s|$)/g;
const MATCH_BULLET_FLAG = /(?:^|\s)--bullet(?=\s|$)/;
const MATCH_BULLET_FLAG_GLOBAL = /(?:^|\s)--bullet(?=\s|$)/g;
// Capture: leading separator (start or whitespace), `@`, then the token body.
// Token body is non-whitespace, non-`@` so two adjacent mentions don't merge.
const MATCH_AT_TOKEN = /(?:^|\s)@([^\s@]+)/;
