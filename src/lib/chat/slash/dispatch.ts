// Slash command dispatcher.
//
// Maps a `ParsedCommand` to a handler that produces a `Proposal`. Handlers
// never write directly — Apply on the proposal card is what writes through
// the vault. This keeps the LLM and the user on the same path: every write
// is reviewable.

import type { Proposal } from '$lib/chat/proposal';
import type { NotePath } from '$lib/vault/types';

import type { ParsedCommand } from './parser';

// Minimal vault surface needed by handlers. Tests pass a fake; production
// passes the shared vault from $lib/vault.
export interface DispatchVault {
  readRaw(path: NotePath): Promise<string>;
  listNotes(): Promise<NotePath[]>;
}

export interface SlashContext {
  vault: DispatchVault;
  now: () => Date;
  // The chat turn that triggered this dispatch. Anchors the resulting
  // proposal card and lets edit-then-apply reuse the same input.
  sourceTurnId: string;
  // The most recent assistant message in the active session, or undefined
  // if the session has no assistant turns yet. /save defaults to capturing
  // this message.
  lastAssistantMessage?: { id: string; content: string; timestamp: number };
  // The full set of messages in the active session, oldest-first. /save
  // --all serializes the whole thing.
  sessionMessages: { role: string; content: string; timestamp: number }[];
  // Identifier of the chat session, surfaced as `source_chat:` frontmatter
  // on saved notes so the user can trace a saved note back to its origin.
  sessionId: string;
}

export type DispatchResult =
  | { kind: 'proposal'; proposal: Proposal }
  // /organize and other multi-extraction commands surface several proposals
  // at once. Each renders its own card; the user accepts/discards individually.
  | { kind: 'proposals'; proposals: Proposal[]; summary?: string }
  | { kind: 'error'; message: string };

export type SlashHandler = (cmd: ParsedCommand, context: SlashContext) => Promise<DispatchResult>;

const handlers = new Map<ParsedCommand['kind'], SlashHandler>();

export function registerHandler(kind: ParsedCommand['kind'], handler: SlashHandler): void {
  handlers.set(kind, handler);
}

export async function dispatch(cmd: ParsedCommand, context: SlashContext): Promise<DispatchResult> {
  if (cmd.kind === 'unknown') {
    return { kind: 'error', message: `Unknown command: ${cmd.raw}` };
  }
  const handler = handlers.get(cmd.kind);
  if (handler === undefined) {
    return {
      kind: 'error',
      message: `Command not yet implemented: /${cmd.kind}`,
    };
  }
  return handler(cmd, context);
}

// Test seam: clear the registry so each test starts from a known state.
export function resetHandlers(): void {
  handlers.clear();
}
