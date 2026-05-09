// CodeMirror extension that replaces conflict-marker hunks with an inline
// picker UI. Both versions are shown side-by-side with friendly labels
// ("Yours" / "Other device") so the user can read what they'd keep
// without needing to remember the diff3 ours/theirs convention.
//
// The user can also resolve manually by editing the markers out — the
// decoration vanishes once the hunk stops parsing.
//
// Block decorations (the picker widget) can ONLY be supplied via a
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

class HunkPickerWidget extends WidgetType {
  constructor(
    private readonly hunk: ConflictHunk,
    private readonly onResolve: ConflictResolveCallback,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof HunkPickerWidget &&
      other.hunk.from === this.hunk.from &&
      other.hunk.to === this.hunk.to &&
      other.hunk.ours === this.hunk.ours &&
      other.hunk.theirs === this.hunk.theirs
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-conflict-picker';

    const header = document.createElement('div');
    header.className = 'cm-conflict-picker-header';
    header.textContent = 'Merge conflict — pick a version to keep:';
    wrap.append(header);

    wrap.append(
      this.buildOption(view, 'Yours', 'Your version on this device', this.hunk.ours, 'ours'),
      this.buildOption(
        view,
        'Other device',
        'Version pulled from the synced repo',
        this.hunk.theirs,
        'theirs',
      ),
    );

    return wrap;
  }

  override ignoreEvent(): boolean {
    // Default would be to consume click events; we want them so the buttons
    // can fire their handlers.
    return false;
  }

  private buildOption(
    view: EditorView,
    label: string,
    sublabel: string,
    content: string,
    side: ConflictResolution,
  ): HTMLElement {
    const box = document.createElement('div');
    box.className = `cm-conflict-option cm-conflict-option-${side}`;

    const labelRow = document.createElement('div');
    labelRow.className = 'cm-conflict-option-label';

    const labelText = document.createElement('span');
    labelText.className = 'cm-conflict-option-label-text';
    labelText.textContent = label;

    const sublabelText = document.createElement('span');
    sublabelText.className = 'cm-conflict-option-sublabel';
    sublabelText.textContent = sublabel;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-conflict-option-button';
    button.textContent = 'Keep this version';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this.apply(view, side);
    });

    labelRow.append(labelText, sublabelText, button);

    const contentElement = document.createElement('pre');
    contentElement.className = 'cm-conflict-option-content';
    contentElement.textContent =
      content === '' ? '(empty — this version deletes the content)' : content;

    box.append(labelRow, contentElement);
    return box;
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
    // Decoration.replace with a block widget swaps the entire hunk
    // (markers + both bodies) for the picker UI. The user no longer sees
    // raw <<<<<<< / ======= / >>>>>>> markers in the document.
    ranges.push(
      Decoration.replace({
        widget: new HunkPickerWidget(hunk, onResolve),
        block: true,
      }).range(hunk.from, hunk.to),
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
      '.cm-conflict-picker': {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        margin: '0.5rem 0',
        padding: '0.75rem',
        border: '1px solid var(--color-warn)',
        borderRadius: '4px',
        background: 'rgba(255, 159, 64, 0.06)',
      },
      '.cm-conflict-picker-header': {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.72rem',
        fontWeight: '600',
        color: 'var(--color-warn)',
        letterSpacing: '0.02em',
      },
      '.cm-conflict-option': {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.5rem 0.6rem',
        border: '1px solid var(--color-border)',
        borderRadius: '3px',
        background: 'var(--color-bg)',
      },
      '.cm-conflict-option-label': {
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.72rem',
      },
      '.cm-conflict-option-label-text': {
        fontWeight: '600',
      },
      '.cm-conflict-option-sublabel': {
        flex: '1',
        opacity: '0.6',
      },
      '.cm-conflict-option-button': {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.7rem',
        background: 'transparent',
        border: '1px solid var(--color-accent)',
        color: 'var(--color-accent)',
        padding: '0.2rem 0.6rem',
        borderRadius: '3px',
        cursor: 'pointer',
      },
      '.cm-conflict-option-button:hover': {
        opacity: '0.85',
      },
      '.cm-conflict-option-content': {
        margin: '0',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        borderLeft: '2px solid var(--color-border)',
        paddingLeft: '0.5rem',
      },
    }),
  ];
}
