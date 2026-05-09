// Public API for the slash-command module.
//
// Production callers should import `registerCoreHandlers()` once at boot to
// wire up the built-in handlers. The chat page then calls `parseSlashCommand`
// + `dispatch` per turn.

import { registerHandler, type SlashHandler } from './dispatch';
import { appendHandler } from './handlers/append';
import { archiveHandler } from './handlers/archive';
import { editHandler } from './handlers/edit';
import { findHandler } from './handlers/find';
import { journalHandler } from './handlers/journal';
import { listHandler } from './handlers/list';
import { noteHandler } from './handlers/note';
import { organizeHandler } from './handlers/organize';
import { relatedHandler } from './handlers/related';
import { saveHandler } from './handlers/save';
import { tagHandler } from './handlers/tag';
import type { ParsedCommand } from './parser';

export type { ParsedCommand } from './parser';
export { parseSlashCommand } from './parser';
export type { DispatchResult, DispatchVault, SlashContext, SlashHandler } from './dispatch';
export { dispatch, registerHandler, resetHandlers } from './dispatch';
export {
  extractSlashFromResponse,
  loadLlmEmitEnabled,
  saveLlmEmitEnabled,
  SLASH_EMIT_SYSTEM_INSTRUCTION,
} from './llm-emit';
export {
  configureOrganize,
  resetOrganizeForTest,
  type OrganizeLlmRunner,
  type OrganizeSidecarVault,
} from './handlers/organize';
export { configureEdit, resetEditForTest } from './handlers/edit';
export {
  configureRelated,
  configureRelatedForTest,
  makeProductionRetriever,
  type RelatedRetriever,
} from './handlers/related';
export {
  configureFind,
  makeProductionFindRetriever,
  resetFindForTest,
  type FindRetriever,
} from './handlers/find';
export type { SlashLlmRunner } from './llm-runner';

const CORE_HANDLERS: { kind: ParsedCommand['kind']; handler: SlashHandler }[] = [
  { kind: 'save', handler: saveHandler },
  { kind: 'note', handler: noteHandler },
  { kind: 'journal', handler: journalHandler },
  { kind: 'list', handler: listHandler },
  { kind: 'append', handler: appendHandler },
  { kind: 'organize', handler: organizeHandler },
  { kind: 'edit', handler: editHandler },
  { kind: 'related', handler: relatedHandler },
  { kind: 'find', handler: findHandler },
  { kind: 'archive', handler: archiveHandler },
  { kind: 'tag', handler: tagHandler },
];

let coreRegistered = false;

export function registerCoreHandlers(): void {
  if (coreRegistered) return;
  for (const { kind, handler } of CORE_HANDLERS) {
    registerHandler(kind, handler);
  }
  coreRegistered = true;
}
