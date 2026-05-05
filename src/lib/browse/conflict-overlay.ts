// CodeMirror extension that decorates conflict hunks with a small action
// overlay (keep ours / keep theirs). The user can also resolve manually by
// just editing the markers out — the decoration vanishes once the hunk
// stops parsing.
//
// We re-parse the document on every update. The cost is acceptable for
// typical note files (≤ a few KB), and avoids the bookkeeping of an
// incremental decoration approach.

import type { Extension, Range } from '@codemirror/state';
import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

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
    private readonly applyResolution: (side: ConflictResolution) => void,
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

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-conflict-actions';
    wrap.setAttribute('aria-label', 'Conflict resolution actions');

    const ours = document.createElement('button');
    ours.type = 'button';
    ours.textContent = 'keep ours';
    ours.addEventListener('click', (event) => {
      event.preventDefault();
      this.applyResolution('ours');
    });

    const theirs = document.createElement('button');
    theirs.type = 'button';
    theirs.textContent = 'keep theirs';
    theirs.addEventListener('click', (event) => {
      event.preventDefault();
      this.applyResolution('theirs');
    });

    wrap.append(ours, theirs);
    return wrap;
  }

  override ignoreEvent(): boolean {
    // Default would be to consume click events; we want them so the buttons
    // can fire their handlers.
    return false;
  }
}

// State effect that pushes a fresh decoration set in. Used by the view
// plugin below; needed so we can pass the resolve callback through.
const setConflictDecorations = StateEffect.define<DecorationSet>();

const conflictField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (current, transaction) => {
    // current.map is DecorationSet#map (positional remap across changes),
    // not Array#map — the unicorn rule cannot tell these apart.
    // eslint-disable-next-line unicorn/no-array-callback-reference
    let next = current.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setConflictDecorations)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function conflictOverlay(onResolve: ConflictResolveCallback): Extension {
  return [
    conflictField,
    ViewPlugin.fromClass(
      class {
        constructor(view: EditorView) {
          this.refresh(view);
        }
        update(update: ViewUpdate): void {
          if (update.docChanged) this.refresh(update.view);
        }
        refresh(view: EditorView): void {
          const text = view.state.doc.toString();
          const hunks = parseConflicts(text);
          const ranges: Range<Decoration>[] = [];
          for (const hunk of hunks) {
            const widget = new HunkActionsWidget(hunk, (side) => {
              const current = view.state.doc.toString();
              // Re-parse against the live document so an action stays
              // valid even if other hunks were resolved between paint
              // and click.
              const live = parseConflicts(current);
              const target = live.find((h) => h.from === hunk.from);
              if (target === undefined) return;
              onResolve(resolveHunk(current, target, side));
            });
            ranges.push(
              Decoration.mark({ class: 'cm-conflict-hunk' }).range(hunk.from, hunk.to),
              Decoration.widget({ widget, side: -1, block: true }).range(hunk.from),
            );
          }
          view.dispatch({ effects: setConflictDecorations.of(Decoration.set(ranges, true)) });
        }
      },
    ),
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
