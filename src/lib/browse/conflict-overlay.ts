// CodeMirror extension that decorates conflict hunks with a small action
// overlay (keep ours / keep theirs). The user can also resolve manually by
// just editing the markers out — the decoration vanishes once the hunk
// stops parsing.
//
// We re-parse the document on every doc change. The cost is acceptable for
// typical note files (≤ a few KB), and avoids the bookkeeping of an
// incremental decoration approach.
//
// Block decorations (the action button row) can ONLY be provided via a
// StateField — CodeMirror explicitly forbids ViewPlugin-supplied block
// decorations and throws "Block decorations may not be specified via
// plugins" at first measure. So this module derives all decorations
// inside a StateField. The click handler reaches the view through
// WidgetType.toDOM(view), not via closure capture.

import { type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

import {
  parseConflicts,
  resolveHunk,
  type ConflictHunk,
  type ConflictResolution,
} from './conflict';

export type ConflictResolveCallback = (next: string) => void;

class HunkActionsWidget extends WidgetType {
  constructor(
    private readonly hunk: ConflictHunk,
    private readonly onResolve: ConflictResolveCallback,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof HunkActionsWidget &&
      other.hunk.from === this.hunk.from &&
      other.hunk.to === this.hunk.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-conflict-actions';
    wrap.setAttribute('aria-label', 'Conflict resolution actions');

    const ours = document.createElement('button');
    ours.type = 'button';
    ours.textContent = 'keep ours';
    ours.addEventListener('click', (event) => {
      event.preventDefault();
      this.apply(view, 'ours');
    });

    const theirs = document.createElement('button');
    theirs.type = 'button';
    theirs.textContent = 'keep theirs';
    theirs.addEventListener('click', (event) => {
      event.preventDefault();
      this.apply(view, 'theirs');
    });

    wrap.append(ours, theirs);
    return wrap;
  }

  override ignoreEvent(): boolean {
    // Default would be to consume click events; we want them so the buttons
    // can fire their handlers.
    return false;
  }

  private apply(view: EditorView, side: ConflictResolution): void {
    const current = view.state.doc.toString();
    // Re-parse against the live document so an action stays valid even if
    // other hunks were resolved between paint and click.
    const live = parseConflicts(current);
    const target = live.find((h) => h.from === this.hunk.from);
    if (target === undefined) return;
    this.onResolve(resolveHunk(current, target, side));
  }
}

function buildDecorations(text: string, onResolve: ConflictResolveCallback): DecorationSet {
  const hunks = parseConflicts(text);
  const ranges: Range<Decoration>[] = [];
  for (const hunk of hunks) {
    ranges.push(
      Decoration.widget({
        widget: new HunkActionsWidget(hunk, onResolve),
        side: -1,
        block: true,
      }).range(hunk.from),
      Decoration.mark({ class: 'cm-conflict-hunk' }).range(hunk.from, hunk.to),
    );
  }
  return Decoration.set(ranges, true);
}

export function conflictOverlay(onResolve: ConflictResolveCallback): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state.doc.toString(), onResolve);
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value;
      return buildDecorations(transaction.newDoc.toString(), onResolve);
    },
    provide(self) {
      return EditorView.decorations.from(self);
    },
  });

  return [
    field,
    EditorView.theme({
      '.cm-conflict-hunk': {
        backgroundColor: 'rgba(255, 159, 64, 0.08)',
        outline: '1px dashed var(--color-warn)',
      },
      '.cm-conflict-actions': {
        display: 'flex',
        gap: '0.5rem',
        padding: '0.25rem 0.5rem',
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-warn)',
        borderBottom: '1px solid var(--color-warn)',
      },
      '.cm-conflict-actions button': {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        background: 'transparent',
        border: '1px solid var(--color-warn)',
        color: 'var(--color-warn)',
        padding: '0.15rem 0.5rem',
        borderRadius: '3px',
        cursor: 'pointer',
      },
    }),
  ];
}
