// Custom merge driver for isomorphic-git's `merge` step.
//
// Why this exists: isomorphic-git 1.37's default mergeDriver, when called
// with `abortOnConflict: false`, throws `MergeConflictError` on overlap
// but does NOT actually write conflict markers to the working tree.
// That left the editor blameless ("no markers found") even though the
// engine had reported a conflict. With this driver wired in, conflicts
// produce diff3-style marker output that the editor's overlay can
// decorate and the user can resolve.
//
// `diff3` is already a transitive dep of isomorphic-git, so we don't
// add anything to the dependency tree.

// @ts-expect-error -- diff3 ships no .d.ts file. The `default` import is
// the CJS module.exports = diff3Merge function (signature documented
// inline below).
import diff3Merge from 'diff3';

// diff3Merge(a, o, b) returns an array of segments, each either
// `{ ok: string[] }` (lines agreed-on or only one side changed) or
// `{ conflict: { a, o, b, ... } }` (true 3-way conflict, with all three
// sides' lines so the caller can format them however it wants).
type Diff3Segment = { ok: string[] } | { conflict: { a: string[]; b: string[] } };
type Diff3MergeFunction = (a: string[], o: string[], b: string[]) => Diff3Segment[];

const merge = diff3Merge as Diff3MergeFunction;

interface MergeDriverParameters {
  branches: string[];
  contents: string[];
}

interface MergeDriverResult {
  cleanMerge: boolean;
  mergedText: string;
}

export function diff3MergeDriver(parameters: MergeDriverParameters): MergeDriverResult {
  const [baseBranch = 'base', oursBranch = 'ours', theirsBranch = 'theirs'] = parameters.branches;
  const [base = '', ours = '', theirs = ''] = parameters.contents;

  const baseLines = splitKeepEol(base);
  const oursLines = splitKeepEol(ours);
  const theirsLines = splitKeepEol(theirs);

  const segments = merge(oursLines, baseLines, theirsLines);

  let cleanMerge = true;
  const out: string[] = [];
  for (const segment of segments) {
    if ('ok' in segment) {
      out.push(...segment.ok);
      continue;
    }
    cleanMerge = false;
    // diff3-style markers, with newlines on the marker lines so they sit
    // on their own row in the output regardless of whether the
    // surrounding hunks ended cleanly.
    out.push(
      `<<<<<<< ${oursBranch}\n`,
      ...withTrailingNewlines(segment.conflict.a),
      `=======\n`,
      ...withTrailingNewlines(segment.conflict.b),
      `>>>>>>> ${theirsBranch}\n`,
    );
  }

  void baseBranch;

  return { cleanMerge, mergedText: out.join('') };
}

// Split text into "lines" that retain their trailing newlines so we can
// reconstruct the file byte-for-byte. The last line may have no
// trailing newline; we preserve that exactly.
function splitKeepEol(text: string): string[] {
  if (text === '') return [];
  const matches = text.match(/[^\n]*\n|[^\n]+$/g);
  return matches ?? [];
}

// Conflict segments from diff3 are line arrays without guaranteed
// trailing newlines. Make sure each line ends in \n so the markers
// sit on their own rows.
function withTrailingNewlines(lines: string[]): string[] {
  return lines.map((line) => (line.endsWith('\n') ? line : `${line}\n`));
}
