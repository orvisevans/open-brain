// LLM-driven note organization.
//
// Given a "messy" note (daily journal, inbox capture), ask the model to
// identify discrete extractions worth their own files / list entries.
// Output is parsed into a structured Suggestion[] and (separately) cached
// to a `.suggestions.json` sidecar.
//
// We use a fenced-block protocol rather than JSON-mode because it composes
// with the rest of the slash-command surface (slash text out, slash text in)
// and degrades gracefully — a malformed block just gets skipped instead of
// failing the whole organize.

import type { Suggestion, SuggestionKind } from './suggestions';

export const ORGANIZE_SYSTEM_PROMPT = [
  'You are a note-organization assistant for a personal knowledge system.',
  'Read the note below and identify up to 5 things worth extracting as separate',
  'first-class entries. Examples of extractable items:',
  '- A standalone idea worth its own note',
  '- A person mentioned with enough context to file under a person note',
  '- A task or follow-up that belongs in a list',
  '- A fact that deserves to be cited later',
  '',
  'Output ONE block per extraction in this exact format:',
  '',
  'EXTRACT',
  'kind: idea | person | task | fact | list-item',
  'title: <short title>',
  'excerpt: <pull-quote from the source, ≤ 200 chars>',
  'content:',
  '<full markdown content for the new file or list entry, may span multiple lines>',
  'END',
  '',
  'If the note has nothing worth extracting, output exactly: NO_EXTRACTIONS',
  '',
  'Do not include any text before, between, or after the EXTRACT/END blocks.',
].join('\n');

export function buildOrganizePrompt(notePath: string, content: string): string {
  return `Note path: ${notePath}\n\nContent:\n${content}`;
}

// Parse the model's output into structured suggestions. Tolerant of minor
// formatting drift: missing fields are skipped, malformed blocks are dropped.
export function parseOrganizeOutput(output: string): Suggestion[] {
  const trimmed = output.trim();
  if (trimmed === '' || trimmed.startsWith('NO_EXTRACTIONS')) return [];

  const suggestions: Suggestion[] = [];
  const blocks = trimmed.split(/^EXTRACT\s*$/m).slice(1); // first segment is preamble noise
  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed !== undefined) suggestions.push(parsed);
  }
  return suggestions;
}

function parseBlock(block: string): Suggestion | undefined {
  // Strip a trailing END marker (and anything after it on its own line).
  const endIndex = block.search(/^END\s*$/m);
  const body = endIndex === -1 ? block : block.slice(0, endIndex);
  const lines = body.split('\n');

  let kind: SuggestionKind | undefined;
  let title: string | undefined;
  let excerpt: string | undefined;
  const contentLines: string[] = [];
  let inContent = false;

  for (const rawLine of lines) {
    const line = rawLine;
    if (!inContent) {
      const headerMatch = /^(kind|title|excerpt|content)\s*:\s*(.*)$/i.exec(line.trim());
      if (headerMatch !== null) {
        const key = headerMatch[1]?.toLowerCase();
        if (key === undefined) continue;
        const value = headerMatch[2]?.trim() ?? '';
        switch (key) {
          case 'kind': {
            kind = normaliseKind(value);
            break;
          }
          case 'title': {
            title = value;
            break;
          }
          case 'excerpt': {
            excerpt = value === '' ? undefined : value;
            break;
          }
          case 'content': {
            inContent = true;
            if (value !== '') contentLines.push(value);
            break;
          }
          default: {
            // Unrecognised header — skip silently; tolerant of LLM drift.
            break;
          }
        }
        continue;
      }
      // Skip blank or unrecognised lines until we find a header.
      continue;
    }
    contentLines.push(line);
  }

  if (kind === undefined || title === undefined || title === '') return undefined;
  const content = contentLines.join('\n').trim();
  if (content === '') return undefined;

  const suggestion: Suggestion = {
    kind,
    title,
    content,
    ...(excerpt !== undefined && excerpt !== '' && { excerpt }),
  };
  return suggestion;
}

function normaliseKind(raw: string): SuggestionKind | undefined {
  const lowered = raw.toLowerCase().trim();
  switch (lowered) {
    case 'idea':
    case 'person':
    case 'task':
    case 'fact':
    case 'list-item': {
      return lowered;
    }
    default: {
      return undefined;
    }
  }
}
