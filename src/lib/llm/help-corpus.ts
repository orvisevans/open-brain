// Help corpus (Phase 5.9.2).
//
// App-bundled, read-only documentation surfaced via two paths:
//
//   1. Retrieval — `.openbrain/help/*.md` is admitted through
//      `notifyMemoryOfChange` (unlike the rest of `.openbrain/`) and rides
//      the standard embedding pipeline. When a user asks "how do I save a
//      journal entry?", the relevant chunk lands in the system prompt's
//      retrieval block.
//   2. Deterministic `/help` — the slash handler reads
//      `slash-commands.md` directly and returns the matching `## /<name>`
//      section without an LLM call. Same source of truth, two surfaces.
//
// Files are bundled as a TS constant so updates ship atomically with the
// code. The on-disk copy carries a `<!-- openbrain-help: vN -->` marker;
// `ensureHelpCorpus` rewrites whenever the marker is missing or behind
// `HELP_CORPUS_VERSION`. Users can still edit the files (the vault
// editor stays writable), but the next mount that runs with a new
// version will clobber.

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

export const HELP_CORPUS_VERSION = 1;
export const HELP_CORPUS_VERSION_MARKER = '<!-- openbrain-help:';

// The slash-commands enumerated in the parser. Used to wire up
// /help <command> lookups and the test that asserts each command has a
// dedicated section in the help corpus. Kept here (not imported from the
// parser) so the corpus is the canonical reference for help discovery.
export const HELP_COMMAND_NAMES = [
  'save',
  'note',
  'journal',
  'list',
  'append',
  'organize',
  'edit',
  'related',
  'find',
  'archive',
  'tag',
  'help',
] as const;

export type HelpCommandName = (typeof HELP_COMMAND_NAMES)[number];

const HELP_DIR = '.openbrain/help';
export const HELP_GETTING_STARTED_PATH: NotePath = `${HELP_DIR}/getting-started.md`;
export const HELP_SLASH_COMMANDS_PATH: NotePath = `${HELP_DIR}/slash-commands.md`;
export const HELP_VAULT_LAYOUT_PATH: NotePath = `${HELP_DIR}/vault-layout.md`;

function withVersionMarker(content: string): string {
  return `${HELP_CORPUS_VERSION_MARKER} v${String(HELP_CORPUS_VERSION)} -->\n\n${content.trimStart()}`;
}

const GETTING_STARTED = `# Getting started with Open Brain

## What is Open Brain?

Open Brain is a personal second-brain that lives entirely in your browser
and syncs its notes to a private GitHub repository. The language model
runs locally on your device via WebLLM — Open Brain never sends your
notes, chats, or queries to a third-party server. Embeddings, retrieval,
and chat all happen in the same tab that's rendering this help file.

The shape of the app is intentional: chat is the primary surface,
slash commands are the verbs, and your vault on disk is the durable
record. Anything the model "remembers" about you is either retrieved
from notes in the vault or pulled from \`.openbrain/persona.md\` —
no hidden state.

## First-run flow

1. **Sign in to GitHub** in /setup. Open Brain uses a GitHub App
   installation scoped to the single repo you pick as your vault.
2. **Pick a model variant** in /setup. Smaller variants (Llama 3.2 1B)
   load fast; larger variants (Gemma 2B) reason more carefully. The
   weights are cached on disk after the first download, so subsequent
   loads are near-instant.
3. **Start typing in /chat**. Plain prose is small-talk and retrieval;
   slash commands like \`/journal\` or \`/note\` create durable notes.

## What retrieval does

Every chat turn, Open Brain embeds your message and pulls the top
matching chunks from your notes, your journal, your lists, and your
past chat sessions. The chunks land in the model's context as a
cite-able context block — when the model draws from one, it should
quote the path. If the model says "I don't know", it's telling you
the retrieval didn't surface a useful match; rephrasing the question
or writing the missing note is the right next step.

Small talk is exempt: greetings and meta-questions about Open Brain
itself shouldn't trigger note retrieval as the source of truth. If
the model starts citing irrelevant notes for a "hi", that's a bug
worth filing.

## Where things live

- **Your notes** live in \`notes/\`, \`journal/\`, and \`lists/\` on the
  GitHub repo. Every slash command that creates content writes to
  one of these directories. Edit them anywhere — the next sync pulls
  the changes back.
- **Your persona** lives at \`.openbrain/persona.md\` and is sent to the
  model on every chat turn. Keep it short; every word competes with
  retrieval for the model's context window.
- **App-shipped help** (this file and its siblings) live under
  \`.openbrain/help/\`. They're rewritten on update — edit
  \`.openbrain/persona.md\` instead if you want to add your own
  instructions.

## When the model feels confused

A few patterns to recognise:

- **Out-of-order answers.** If the model replies about something
  you said two turns ago, it's mis-weighting the conversation
  history. Re-asking with a clearer subject usually unblocks it.
- **Hallucinated actions.** If the model says "I've saved that" when
  no proposal card appeared, no save happened. Only the green
  proposal card represents a real write.
- **Citation drift.** If the model cites a note that has nothing to
  do with your question, the embedding match was weak. Try
  \`/find <query>\` to see the raw top-K matches and decide whether
  the relevant note exists at all.

For details on any command, run \`/help <command>\` or just ask.
`;

const SLASH_COMMANDS_DOC = `# Slash commands

Open Brain's verbs. Each command produces either a **proposal card**
(a reviewable write you accept or discard) or a **system message**
(a read-only result rendered inline). No command writes to your
vault without your explicit confirmation.

## /save

Saves the most recent assistant turn as a new note, or — with
\`--all\` — the entire conversation. Use this when the model produced
something worth keeping outside the chat scroll.

- \`/save\` — captures the last assistant message into a new note.
- \`/save @notes/foo\` — saves to a specific path (created if missing).
- \`/save my new note\` — saves under a title-derived path.
- \`/save --all\` — captures the whole conversation as a single note.

The saved note carries \`source_chat:\` frontmatter pointing at the
session, so you can trace any saved note back to its origin.

## /note

Creates a new note in \`notes/\` from a title (and optional body).

- \`/note My ideas\` — creates \`notes/my-ideas.md\` with the title as h1.
- \`/note My ideas\\nthe body goes here\` — adds a body paragraph.

Slugification is conservative: lowercase, hyphens for spaces,
ASCII-only. Title collisions append a numeric suffix.

## /journal

Appends to today's daily note at \`journal/YYYY-MM-DD.md\` (UTC).
Each entry is timestamped under an \`## Entries\` heading.

- \`/journal felt great today, made progress on the proxy\`

If today's file doesn't exist yet, the command creates it with the
standard journal frontmatter (\`type: journal\`).

## /list

Appends an item to a running list at \`lists/<name>.md\`. The list is
a bulleted markdown file with an h1 title.

- \`/list groceries milk\` — appends \`- milk\` to \`lists/groceries.md\`.
- \`/list groceries\` — opens the list as a proposal for inspection
  (no item added).

## /append

Appends raw or bulleted text to a specific note.

- \`/append @notes/foo more thoughts\` — adds a paragraph at the end.
- \`/append @notes/foo - new bullet\` — preserves the leading dash,
  added as a list item.

The append is non-destructive: existing content is untouched, the
diff in the proposal shows exactly what's being added.

## /organize

Reads a messy note and proposes a reorganised version (headings,
bullet grouping, light copy-edits). Calls the local model, so it
takes a few seconds.

- \`/organize @journal/2026-05-19\` — reorganises the day's entries.
- \`/organize @notes/foo\` — restructures any note.

Returns a proposal you can apply, edit before applying, or discard.
The original is preserved until you accept.

## /edit

Like \`/organize\` but driven by a natural-language instruction.

- \`/edit @notes/foo make the tone more terse\`
- \`/edit @lists/groceries group by aisle\`

The model rewrites the note according to your instruction. Same
proposal flow as \`/organize\`.

## /related

Finds notes thematically related to a given note via embedding
similarity (cosine over chunk vectors). Returns an inline list, no
write.

- \`/related @notes/foo\` — top-N notes that overlap in subject.

Useful for spelunking — "what else have I written about X?"

## /find

Pure embedding search across notes and past chats. Cheap,
high-frequency. Returns an inline list with snippets.

- \`/find protocol research\`
- \`/find dentist appointment\`

Chats are first-class results: a \`/find\` hit can be a question you
asked three weeks ago, with the user-side snippet shown so you
recognise it. Assistant turns are excluded by default.

## /archive

Moves a note to \`archive/<original-path>\`. Reversible: the file
isn't deleted, just shelved. Embeddings are re-emitted from the new
path so retrieval continues to surface archived notes (de-prioritised
by the path-prefix signal).

- \`/archive @notes/foo\`

## /tag

Adds tags to a note's frontmatter (creates the \`tags:\` field if
missing).

- \`/tag @notes/foo work,product,2026q2\`

Tags are stable strings — searchable via \`/find\` and surfaced in
Browse as filter chips (future).

## /help

Deterministic help — no LLM call, instant response.

- \`/help\` — lists every command with a one-line description.
- \`/help <command>\` — returns this file's section for that command.

\`/help\` reads its content from this file (\`.openbrain/help/slash-commands.md\`),
so what you see here is exactly what the command returns. To extend
help for a custom command, edit this file — though Open Brain will
rewrite it on the next version bump.
`;

const VAULT_LAYOUT = `# Vault layout

Your Open Brain vault is a regular GitHub repository. Every file is
human-readable markdown plus a small handful of bookkeeping files.
You can edit any of it from outside Open Brain — the next sync pulls
your changes back.

## \`notes/\`

Curated notes. The output of \`/note\`, \`/save\`, \`/edit\`,
\`/organize\`, \`/append\`, \`/tag\`. Anything you'd file under "I want
to remember this" belongs here.

Notes are flat by default (\`notes/foo.md\`) but the directory accepts
arbitrary subfolders if you want to organise (\`notes/projects/foo.md\`).
Embeddings index the whole tree.

## \`journal/\`

Daily notes at \`journal/YYYY-MM-DD.md\` (UTC). The output of
\`/journal\`. Each file is one day; each entry inside a file is
timestamped under \`## Entries\`. Auto-organize (Phase 5.8) may
surface entries here as candidates for extraction into curated
notes.

## \`lists/\`

Running lists at \`lists/<name>.md\`. The output of \`/list\`. Each
file is one list with an h1 title and bullet items. Lists are
append-mostly — \`/list <name> <item>\` adds a bullet without
otherwise touching the file.

## \`archive/\`

Notes moved out of \`notes/\` via \`/archive\`. The file structure
mirrors the original path inside the archive root. Embeddings still
cover archived notes (de-prioritised), so \`/find\` can surface them
but they don't dominate the retrieval block.

## \`.chats/\`

Past chat sessions, one file per session. Format: frontmatter plus
alternating \`## role · timestamp\` blocks. These files are
**read-only in Browse** — to continue a session, open it in /chat.

Chats are indexed by the embedding pipeline (Phase 5.7), so a
question you asked last week can come back through retrieval. The
chat-chunker emits one chunk per substantive message, tagged with
role + message index + timestamp.

## \`.openbrain/\`

App-owned state. Excluded from sync triggers and from retrieval,
**except** for the help corpus described below.

- \`.openbrain/persona.md\` — your free-form prose persona, included
  in the system prompt every chat turn. Editable; keep it short.
- \`.openbrain/help/\` — this corpus. App-shipped, read-only-ish
  (Open Brain rewrites it on version bumps). Indexed by retrieval
  so questions about Open Brain itself find authoritative answers.
- \`.openbrain/command-stats.json\` — frecency tracking for the
  mention popover (Phase 5.5). Not human-meaningful; safe to delete.
- \`.openbrain/last-review-at\` — daily-review timestamp. Same.

## \`.memory/\`

Embedding sidecars and extraction outputs. One \`.json\` sidecar per
indexed file, plus a queue persistence file. Generated by the
memory pipeline, not human-edited. Safe to delete the whole
directory — Open Brain re-indexes from scratch on next mount,
which takes a minute or two on a fresh vault.

## Sync model

Writes flow vault → IndexedDB (LightningFS) → GitHub. Reads flow
GitHub → IndexedDB → vault. The sync engine batches writes and
pushes commits; conflicts surface in Browse as inline diff markers
you resolve by clicking "keep ours" or "keep theirs". Nothing is
silently lost.
`;

export interface HelpFile {
  path: NotePath;
  content: string;
}

export const HELP_CORPUS: HelpFile[] = [
  { path: HELP_GETTING_STARTED_PATH, content: withVersionMarker(GETTING_STARTED) },
  { path: HELP_SLASH_COMMANDS_PATH, content: withVersionMarker(SLASH_COMMANDS_DOC) },
  { path: HELP_VAULT_LAYOUT_PATH, content: withVersionMarker(VAULT_LAYOUT) },
];

// Path-prefix predicate used by `notifyMemoryOfChange` (admit through the
// `.openbrain/` filter) and by Browse (read-only banner).
export function isHelpCorpusPath(path: string): boolean {
  return path.startsWith(`${HELP_DIR}/`) && path.endsWith('.md');
}

// Returns the marker version embedded in `content`, or 0 if absent /
// unreadable. Used by `ensureHelpCorpus` to decide whether to rewrite.
export function readEmbeddedVersion(content: string): number {
  const match = /<!--\s*openbrain-help:\s*v(\d+)\s*-->/.exec(content);
  if (match === null) return 0;
  const parsed = Number.parseInt(match[1] ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Extracts the `## /<name>` section from the slash-commands doc.
// Returns undefined when the heading isn't found (the caller surfaces
// an unknown-command error). Used by the deterministic /help handler.
export function extractCommandSection(name: string): string | undefined {
  const slashDocument = SLASH_COMMANDS_DOC;
  const heading = `## /${name}`;
  const start = slashDocument.indexOf(`\n${heading}\n`);
  if (start === -1) return undefined;
  const afterHeading = start + 1;
  // Find the next "## " at line start (a sibling section) — that's where
  // this section ends.
  const nextSectionMatch = /\n## /.exec(slashDocument.slice(afterHeading + heading.length));
  const end =
    nextSectionMatch === null
      ? slashDocument.length
      : afterHeading + heading.length + nextSectionMatch.index;
  return slashDocument.slice(afterHeading, end).trimEnd();
}

export interface HelpCorpusReadVault {
  readRaw(path: NotePath): Promise<string>;
}

export interface HelpCorpusWriteVault {
  writeNote(path: NotePath, content: string): Promise<void>;
}

// First-run + version-bump helper. For each entry in HELP_CORPUS, writes
// to disk if (a) the file is missing or (b) its embedded version marker
// is behind HELP_CORPUS_VERSION. Otherwise leaves the file alone — a
// user who copied or edited the doc locally keeps their copy until the
// next version bump clobbers it.
//
// Caller is responsible for not double-firing. Safe to call repeatedly.
export async function ensureHelpCorpus(
  readVault: HelpCorpusReadVault,
  writeVault: HelpCorpusWriteVault,
): Promise<{ written: NotePath[] }> {
  const written: NotePath[] = [];
  for (const file of HELP_CORPUS) {
    let existing: string | undefined;
    try {
      existing = await readVault.readRaw(file.path);
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        logError('help-corpus/ensure-read', { path: file.path, error });
        continue;
      }
    }
    if (existing !== undefined && readEmbeddedVersion(existing) >= HELP_CORPUS_VERSION) {
      continue;
    }
    try {
      await writeVault.writeNote(file.path, file.content);
      written.push(file.path);
    } catch (error: unknown) {
      logError('help-corpus/ensure-write', { path: file.path, error });
    }
  }
  return { written };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}

// Used by `/help` (no-arg) to list every command with a short hook.
// Drawn from the slash-commands doc by stripping the section body and
// keeping just the first non-heading paragraph.
export function listCommandShortHelp(): { name: HelpCommandName; summary: string }[] {
  return HELP_COMMAND_NAMES.map((name) => {
    const section = extractCommandSection(name);
    if (section === undefined) return { name, summary: '' };
    // First non-empty line after the heading.
    const lines = section.split('\n').slice(1);
    const summary = lines.find((line) => line.trim() !== '')?.trim() ?? '';
    return { name, summary };
  });
}
