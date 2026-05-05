// Conflict-marker parsing — pure logic, testable.
//
// isomorphic-git writes diff3 markers into working files when a merge has
// overlapping changes. The format is:
//
//   <<<<<<< ours
//   our lines
//   =======
//   their lines
//   >>>>>>> theirs
//
// or with the `||||||| base` separator interleaved (diff3 style). We
// recognise both. Each hunk's character offsets are returned so a
// CodeMirror decorator can target them precisely.

export interface ConflictHunk {
  // Inclusive start index of the leading `<<<<<<<` line.
  from: number;
  // Exclusive end index just past the trailing `>>>>>>>` line's newline.
  to: number;
  // The "ours" body (between `<<<<<<<` and the first separator).
  ours: string;
  // The "theirs" body (between the last separator and `>>>>>>>`).
  theirs: string;
}

const START_RE = /^<{7}.*$/m;
const SEP_BASE_RE = /^\|{7}.*$/m;
const SEP_RE = /^={7}\s*$/m;
const END_RE = /^>{7}.*$/m;

export function parseConflicts(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remainder = text.slice(cursor);
    const startMatch = START_RE.exec(remainder);
    if (startMatch === null) break;

    const startAbs = cursor + startMatch.index;
    const afterStartLine = startAbs + startMatch[0].length + 1; // +1 for newline

    const tail = text.slice(afterStartLine);
    const endMatch = END_RE.exec(tail);
    if (endMatch === null) break;

    const endLineStart = afterStartLine + endMatch.index;
    const endLineEnd = endLineStart + endMatch[0].length;
    const region = text.slice(afterStartLine, endLineStart);

    // Find the `=======` separator. There may also be a `|||||||` base
    // separator from diff3 — we ignore the base segment for simplicity.
    const separatorMatch = SEP_RE.exec(region);
    if (separatorMatch === null) {
      cursor = endLineEnd;
      continue;
    }

    const oursRaw = region.slice(0, separatorMatch.index);
    let theirsRaw = region.slice(separatorMatch.index + separatorMatch[0].length + 1);

    // Strip a diff3 base segment if present at the head of the "ours" half.
    const baseMatch = SEP_BASE_RE.exec(oursRaw);
    let ours = oursRaw;
    if (baseMatch !== null) {
      ours = oursRaw.slice(0, baseMatch.index);
    }

    // Normalise: parsed bodies don't include the marker lines, but they may
    // end with a trailing newline that the renderer doesn't want twice.
    if (ours.endsWith('\n')) ours = ours.slice(0, -1);
    if (theirsRaw.endsWith('\n')) theirsRaw = theirsRaw.slice(0, -1);

    // `to` is the position just after the trailing newline (so a downstream
    // splice replacing [from, to) leaves the rest of the document intact).
    const toExclusive =
      endLineEnd < text.length && text.charAt(endLineEnd) === '\n' ? endLineEnd + 1 : endLineEnd;

    hunks.push({ from: startAbs, to: toExclusive, ours, theirs: theirsRaw });
    cursor = toExclusive;
  }

  return hunks;
}

export type ConflictResolution = 'ours' | 'theirs';

/**
 * Apply a per-hunk resolution: replace [hunk.from, hunk.to) with either
 * `hunk.ours` or `hunk.theirs`. Other hunks remain untouched.
 */
export function resolveHunk(text: string, hunk: ConflictHunk, side: ConflictResolution): string {
  const replacement = side === 'ours' ? hunk.ours : hunk.theirs;
  // Preserve exactly one trailing newline if the original region ended with one.
  const original = text.slice(hunk.from, hunk.to);
  const trailing = original.endsWith('\n') ? '\n' : '';
  return text.slice(0, hunk.from) + replacement + trailing + text.slice(hunk.to);
}
