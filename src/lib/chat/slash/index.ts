// Public API for the slash-command module.
//
// Production callers should import `registerCoreHandlers()` once at boot to
// wire up the built-in handlers. The chat page then calls `parseSlashCommand`
// + `dispatch` per turn.

import { registerHandler, type SlashHandler } from './dispatch';
import { appendHandler } from './handlers/append';
import { journalHandler } from './handlers/journal';
import { listHandler } from './handlers/list';
import { noteHandler } from './handlers/note';
import { saveHandler } from './handlers/save';
import type { ParsedCommand } from './parser';

export type { ParsedCommand } from './parser';
export { parseSlashCommand } from './parser';
export type { DispatchResult, DispatchVault, SlashContext, SlashHandler } from './dispatch';
export { dispatch, registerHandler, resetHandlers } from './dispatch';

const CORE_HANDLERS: { kind: ParsedCommand['kind']; handler: SlashHandler }[] = [
  { kind: 'save', handler: saveHandler },
  { kind: 'note', handler: noteHandler },
  { kind: 'journal', handler: journalHandler },
  { kind: 'list', handler: listHandler },
  { kind: 'append', handler: appendHandler },
];

let coreRegistered = false;

export function registerCoreHandlers(): void {
  if (coreRegistered) return;
  for (const { kind, handler } of CORE_HANDLERS) {
    registerHandler(kind, handler);
  }
  coreRegistered = true;
}
