// Minimal handwritten YAML-frontmatter parser.
//
// Scope (Phase 2):
//   - Detects a leading `---\n…\n---` block.
//   - Parses flat `key: value` pairs.
//   - Parses inline-list values: `key: [a, b, c]` (commas split, surrounding
//     whitespace and matching quotes stripped per item).
//   - Coerces obvious literals: `true`, `false`, `null` (→ undefined),
//     integers, floats.
//   - Strips matching surrounding quotes from string values.
//
// Out of scope until Phase 4 forces it: nested mappings, multi-line block lists
// (`- item`), block scalars (`|`, `>`), anchors/aliases, escape sequences.
// Anything we don't understand is preserved as a raw string so a round-trip
// through this parser doesn't lose information from authored frontmatter.

import type { ParsedMarkdown } from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): ParsedMarkdown {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) {
    return { frontmatter: {}, body: content };
  }

  const [fullMatch, rawBlock] = match;
  if (rawBlock === undefined) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = parseBlock(rawBlock);
  const body = content.slice(fullMatch.length);
  return { frontmatter, body };
}

function parseBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    // Skip blank lines and full-line comments.
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    if (key === '') {
      continue;
    }
    const rawValue = line.slice(colonIndex + 1).trim();
    result[key] = parseValue(rawValue);
  }
  return result;
}

function parseValue(raw: string): unknown {
  if (raw === '') {
    return '';
  }

  // Inline list: [a, b, "c, d"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') {
      return [];
    }
    return splitTopLevelCommas(inner).map((item) => parseScalar(item.trim()));
  }

  return parseScalar(raw);
}

function parseScalar(raw: string): unknown {
  if (raw === '') {
    return '';
  }

  // Strip matching surrounding quotes.
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }

  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return undefined;

  // Numbers — only if the entire string is a valid number literal.
  if (/^-?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  if (/^-?\d+\.\d+$/.test(raw)) {
    return Number.parseFloat(raw);
  }

  return raw;
}

// Split on commas that are NOT inside quotes. (Handles `[a, "b, c", d]`.)
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let buffer = '';
  let quote: '"' | "'" | undefined;
  for (const char of input) {
    if (quote !== undefined) {
      buffer += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === ',') {
      out.push(buffer);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  if (buffer !== '') {
    out.push(buffer);
  }
  return out;
}
