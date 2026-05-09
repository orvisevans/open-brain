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
  | { kind: 'edit'; target: NotePath; instruction: string }
  | { kind: 'related'; target: NotePath }
  | { kind: 'find'; query: string }
  | { kind: 'archive'; target: NotePath }
  | { kind: 'tag'; target: NotePath; tags: string[] }
  // `unknown` covers both "totally unrecognized" (no `reason`) and
  // "recognized command but missing required args" (with `reason`).
  // Dispatcher uses `reason` when present for a friendlier error message.
  | { kind: 'unknown'; raw: string; reason?: string };

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
    case 'edit': {
      return parseEdit(argumentsRaw, trimmed);
    }
    case 'related': {
      return parseRelated(argumentsRaw, trimmed);
    }
    case 'find': {
      return parseFind(argumentsRaw);
    }
    case 'archive': {
      return parseArchive(argumentsRaw, trimmed);
    }
    case 'tag': {
      return parseTag(argumentsRaw, trimmed);
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
    return {
      kind: 'unknown',
      raw: '/journal',
      reason: 'Provide an entry: /journal <text>',
    };
  }
  return { kind: 'journal', body: arguments_ };
}

function parseNote(arguments_: string): ParsedCommand {
  if (arguments_.trim() === '') {
    return {
      kind: 'unknown',
      raw: '/note',
      reason: 'Provide a title: /note <title>',
    };
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
    return {
      kind: 'unknown',
      raw: '/note',
      reason: 'Provide a title: /note <title>',
    };
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
    return {
      kind: 'unknown',
      raw: '/list',
      reason: 'Provide a list name: /list <name> [item]',
    };
  }
  // Newline form: name on first line, item is the rest. Useful for multi-line items.
  const newlineIndex = trimmed.indexOf('\n');
  if (newlineIndex !== -1) {
    const name = trimmed.slice(0, newlineIndex).trim();
    const item = trimmed.slice(newlineIndex + 1).trim();
    return name === ''
      ? {
          kind: 'unknown',
          raw: '/list',
          reason: 'Provide a list name: /list <name> [item]',
        }
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
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide a target: /organize @path/to/note.md',
    };
  }
  return { kind: 'organize', target: mentionToPath(targetMatch[1] ?? '') };
}

function parseEdit(arguments_: string, trimmed: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide a target and instruction: /edit @path <what to change>',
    };
  }
  const target = mentionToPath(targetMatch[1] ?? '');
  const instruction = arguments_.replace(targetMatch[0], ' ').trim();
  if (instruction === '') {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide an instruction: /edit @path <what to change>',
    };
  }
  return { kind: 'edit', target, instruction };
}

function parseRelated(arguments_: string, trimmed: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide a target: /related @path/to/note.md',
    };
  }
  return { kind: 'related', target: mentionToPath(targetMatch[1] ?? '') };
}

function parseFind(arguments_: string): ParsedCommand {
  const query = arguments_.trim();
  if (query === '') {
    return {
      kind: 'unknown',
      raw: '/find',
      reason: 'Provide a query: /find <text>',
    };
  }
  return { kind: 'find', query };
}

function parseArchive(arguments_: string, trimmed: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide a target: /archive @path/to/note.md',
    };
  }
  return { kind: 'archive', target: mentionToPath(targetMatch[1] ?? '') };
}

function parseTag(arguments_: string, trimmed: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide a target and tags: /tag @path <tag1> [tag2…]',
    };
  }
  const target = mentionToPath(targetMatch[1] ?? '');
  const remaining = arguments_.replace(targetMatch[0], ' ');
  // Tags are whitespace-separated; strip a leading `#` so `#productivity`
  // and `productivity` both work. Skip empties.
  const tags = remaining
    .split(/\s+/)
    .map((token) => token.replace(/^#/, ''))
    .filter((token) => token !== '');
  if (tags.length === 0) {
    return {
      kind: 'unknown',
      raw: trimmed,
      reason: 'Provide tags: /tag @path <tag1> [tag2…]',
    };
  }
  return { kind: 'tag', target, tags };
}

function parseAppend(arguments_: string): ParsedCommand {
  const targetMatch = MATCH_AT_TOKEN.exec(arguments_);
  if (targetMatch === null) {
    return {
      kind: 'unknown',
      raw: `/append${arguments_ === '' ? '' : ` ${arguments_}`}`,
      reason: 'Provide a target: /append @path <body>',
    };
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
