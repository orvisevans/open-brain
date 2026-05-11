<script lang="ts">
  // Thin Svelte 5 wrapper around CodeMirror 6.
  //
  // Mounts a single EditorView. On `value` prop change from outside (e.g.
  // navigating to a different note) the editor's contents are replaced; while
  // the user is typing, changes flow out via `onChange` only — we don't echo
  // them back through `value`, which would fight the cursor.
  //
  // CRITICAL: the mount effect must NOT track `value` (or any other prop) as
  // a reactive dependency. If it does, every keystroke triggers a teardown
  // and rebuild of the EditorView (focus and selection lost). Reads of all
  // props inside the mount effect go through `untrack()`. The separate
  // value-watcher effect explicitly tracks `value` to handle external swaps.

  import { untrack } from 'svelte';

  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown } from '@codemirror/lang-markdown';
  import { search, searchKeymap } from '@codemirror/search';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';

  import { conflictOverlay } from './conflict-overlay';
  import { wikilinkCompletion, type NotePathProvider } from './wikilink-completion';

  interface Properties {
    value: string;
    onChange: (next: string) => void;
    notes: NotePathProvider;
    /** Called when the user picks "keep ours / keep theirs" on a conflict hunk. */
    onResolveConflict?: (next: string) => void;
    /** Called on Cmd/Ctrl-S — host should flush any pending save immediately. */
    onSave?: () => void;
    /**
     * When true, the editor accepts no input. Used by Phase 5.7 to show chat
     * sessions as readable history without giving the user a way to scribble
     * over them and confuse the chat parser on next load.
     */
    readOnly?: boolean;
  }

  const { value, onChange, notes, onResolveConflict, onSave, readOnly }: Properties = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view: EditorView | undefined;

  $effect(() => {
    if (host === undefined) return;

    // Read every prop via untrack so the only dependency this effect has is
    // `host`. `host` only changes once (when the bind:this populates it) so
    // the editor mounts exactly once for the component's lifetime.
    const initialState = untrack(() =>
      createState(value, onChange, notes, onResolveConflict, onSave, readOnly === true),
    );
    view = new EditorView({ state: initialState, parent: host });

    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  // External value swap (navigating to a new note). We compare against the
  // current document so user keystrokes don't trigger this branch.
  $effect(() => {
    // Only `value` should drive this effect. `view` is a plain `let` so
    // accessing it doesn't track.
    const next = value;
    if (view === undefined) return;
    if (view.state.doc.toString() === next) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
  });

  function createState(
    initial: string,
    onChangeCallback: (next: string) => void,
    notesProvider: NotePathProvider,
    onResolveConflictCallback: ((next: string) => void) | undefined,
    onSaveCallback: (() => void) | undefined,
    isReadOnly: boolean,
  ): EditorState {
    return EditorState.create({
      doc: initial,
      extensions: [
        EditorState.readOnly.of(isReadOnly),
        EditorView.editable.of(!isReadOnly),
        history(),
        keymap.of([
          // Mod-s = Cmd-S on macOS, Ctrl-S elsewhere. CodeMirror normalises
          // this for us. Returning `true` swallows the event so the browser
          // doesn't open its own Save Page dialog.
          {
            key: 'Mod-s',
            run: () => {
              onSaveCallback?.();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        search(),
        markdown(),
        wikilinkCompletion(notesProvider),
        conflictOverlay((next) => {
          // Replace the document so the user sees the resolution immediately,
          // and propagate the change up to the page so it can write through
          // the vault.
          view?.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
          });
          onResolveConflictCallback?.(next);
        }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeCallback(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '0.9rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-fg)',
            backgroundColor: 'transparent',
          },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-content': {
            padding: '0.75rem',
            // We deliberately do NOT include CodeMirror's `drawSelection`
            // extension, so the cursor is the native browser caret on the
            // contenteditable. Pin caretColor to the accent so it's
            // visible on the dark theme.
            caretColor: 'var(--color-accent)',
          },
          '&.cm-focused': { outline: 'none' },
          // .cm-dropCursor (for drag-and-drop drop indicator) and any
          // .cm-cursor produced by drawSelection later still get a
          // contrasting color if those extensions get added in future.
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--color-accent)',
            borderLeftWidth: '2px',
          },
          '::selection': {
            backgroundColor: 'rgba(34, 211, 238, 0.35)',
          },
        }),
      ],
    });
  }
</script>

<div bind:this={host} class="editor-host"></div>

<style>
  .editor-host {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
</style>
