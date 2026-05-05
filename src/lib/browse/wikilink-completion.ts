// Wikilink autocomplete for CodeMirror.
//
// Behaviour: when the user types `[[`, offer note paths from the vault.
// `[[target|display]]` is supported by the parser; this extension only fills
// the `target` portion. The user can append `|display` manually.
//
// CodeMirror's autocomplete API requires `null` (not undefined) for "no
// completions" — see CompletionResult type. Disable the project-wide
// no-null rule for this file rather than fighting the upstream contract.
/* eslint-disable unicorn/no-null */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

// Synchronous candidate provider so the extension stays cheap to call on every
// keystroke. The list of notes is refreshed by the page (e.g. after a save)
// and pushed in via this getter.
export type NotePathProvider = () => readonly string[];

export function wikilinkCompletion(getNotes: NotePathProvider): Extension {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => complete(context, getNotes),
    ],
  });
}

function complete(context: CompletionContext, getNotes: NotePathProvider): CompletionResult | null {
  // Look back from the cursor to the most recent `[[` that hasn't been closed.
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const trigger = before.lastIndexOf('[[');
  if (trigger === -1) return null;

  // Bail if a `]]` has already closed this wikilink.
  if (before.slice(trigger).includes(']]')) return null;

  // Bail if a `|` has been typed — we only complete the target, not the display.
  if (/[|\n]/.test(before.slice(trigger + 2))) return null;

  const from = line.from + trigger + 2;
  const options: Completion[] = getNotes().map((path) => ({
    label: path,
    apply: stripMdSuffix(path),
    type: 'note',
  }));

  return { from, options, validFor: /^[^[\]\n|]*$/ };
}

function stripMdSuffix(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -'.md'.length) : path;
}
