<script lang="ts">
  // Thin Svelte 5 wrapper around CodeMirror 6.
  //
  // Mounts a single EditorView. On `value` prop change from outside (e.g.
  // navigating to a different note) the editor's contents are replaced; while
  // the user is typing, changes flow out via `onChange` only — we don't echo
  // them back through `value`, which would fight the cursor.

  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown } from '@codemirror/lang-markdown';
  import { search, searchKeymap } from '@codemirror/search';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';

  import { wikilinkCompletion, type NotePathProvider } from './wikilink-completion';

  interface Properties {
    value: string;
    onChange: (next: string) => void;
    notes: NotePathProvider;
  }

  const { value, onChange, notes }: Properties = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view: EditorView | undefined;

  $effect(() => {
    if (host === undefined) return;

    view = new EditorView({
      state: createState(value, onChange, notes),
      parent: host,
    });

    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  // External value swap (navigating to a new note). We compare against the
  // current document so user keystrokes don't trigger this branch.
  $effect(() => {
    if (view === undefined) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  });

  function createState(
    initial: string,
    onChangeCallback: (next: string) => void,
    notesProvider: NotePathProvider,
  ): EditorState {
    return EditorState.create({
      doc: initial,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        search(),
        markdown(),
        wikilinkCompletion(notesProvider),
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
          },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-content': { padding: '0.75rem' },
          '&.cm-focused': { outline: 'none' },
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
