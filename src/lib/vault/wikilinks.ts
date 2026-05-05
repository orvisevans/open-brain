// Wikilink extraction.
//
// Recognised forms (per ARCHITECTURE §3):
//   [[target]]
//   [[target|display]]
//
// `target` is a free-form string — the vault does not resolve it to an actual
// `NotePath` here. Resolution (target → existing note vs. dangling link) is
// the caller's job, since it requires cross-referencing `listNotes()`.
//
// Code fences (``` and ~~~) and inline code spans (`…`) are treated as
// non-text — wikilinks inside them are ignored, matching how a markdown
// renderer would handle them.

import type { NotePath, WikilinkReference } from './types';

const WIKILINK_RE = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/g;

export function extractWikilinks(body: string, from: NotePath): WikilinkReference[] {
  const stripped = stripCodeRegions(body);

  const out: WikilinkReference[] = [];
  for (const match of stripped.matchAll(WIKILINK_RE)) {
    const [, rawTarget, rawDisplay] = match;
    if (rawTarget === undefined) continue;
    const target = rawTarget.trim();
    if (target === '') continue;

    const link: WikilinkReference = { from, to: target };
    if (rawDisplay !== undefined) {
      const display = rawDisplay.trim();
      if (display !== '') {
        link.display = display;
      }
    }
    out.push(link);
  }
  return out;
}

// Replace fenced blocks and inline-code spans with whitespace-equivalent
// content so positional information is preserved but the regex above never
// matches inside them.
function stripCodeRegions(body: string): string {
  // Fenced blocks: ``` or ~~~ on a line of its own, until matching closer.
  const withoutFences = body.replaceAll(/(^|\n)([`~]{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (match) =>
    match.replaceAll(/[^\n]/g, ' '),
  );
  // Inline code: `…` (single backtick spans). Multi-backtick spans are rare in
  // notes; this covers the common case without trying to be a full parser.
  return withoutFences.replaceAll(/`[^`\n]+`/g, (match) => ' '.repeat(match.length));
}
