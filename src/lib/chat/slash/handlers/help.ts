// /help — deterministic command discovery (Phase 5.9.2).
//
// No LLM call. Reads from the bundled slash-commands help doc so the
// command output and the indexed help corpus stay in sync.
//
//   /help            → one line per command, sourced from the doc
//   /help <command>  → that command's section, verbatim from the doc
//   /help <unknown>  → error message listing valid commands

import {
  extractCommandSection,
  HELP_COMMAND_NAMES,
  listCommandShortHelp,
} from '$lib/llm/help-corpus';

import type { DispatchResult, SlashHandler } from '../dispatch';

export const helpHandler: SlashHandler = (cmd): Promise<DispatchResult> => {
  if (cmd.kind !== 'help') {
    return Promise.resolve({
      kind: 'error',
      message: 'helpHandler invoked with non-help command',
    });
  }

  if (cmd.command === undefined) {
    return Promise.resolve({ kind: 'message', content: renderIndex() });
  }

  const section = extractCommandSection(cmd.command);
  if (section === undefined) {
    return Promise.resolve({
      kind: 'error',
      message:
        `Unknown command: /${cmd.command}. ` +
        `Try one of: ${HELP_COMMAND_NAMES.map((name) => `/${name}`).join(', ')}.`,
    });
  }

  return Promise.resolve({ kind: 'message', content: section });
};

function renderIndex(): string {
  const lines = ['Commands:'];
  for (const entry of listCommandShortHelp()) {
    const summary = entry.summary === '' ? '' : ` — ${stripTrailingPeriod(entry.summary)}`;
    lines.push(`- /${entry.name}${summary}`);
  }
  lines.push('', 'Run `/help <command>` for details, or ask in plain English.');
  return lines.join('\n');
}

function stripTrailingPeriod(text: string): string {
  return text.endsWith('.') ? text.slice(0, -1) : text;
}
