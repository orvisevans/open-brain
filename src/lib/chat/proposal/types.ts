// Phase 5.5 conversational note ops: a Proposal is a pending write that the
// user must commit via the proposal card UI before it touches the vault.
//
// Proposals are page-state, not session-persistent. After Apply, the file is
// the artifact; after Discard, nothing remains. A short confirmation /
// dismissal message is appended to the chat session as a system message.

import type { NotePath } from '$lib/vault/types';

export type ProposalOp = 'create' | 'append' | 'replace';

export interface Proposal {
  id: string;
  target: NotePath;
  op: ProposalOp;
  // Verbatim file content before the change. Empty for `create`.
  existingContent: string;
  // What `applyProposal` writes. For `append`, this is `existingContent` plus
  // the new chunk; for `create`, this is the whole new file.
  finalContent: string;
  // One-line summary surfaced in the card header (e.g. "Append eggs to grocery").
  summary: string;
  // Optional sub-header for handler context (e.g. "deduplicated by embedding").
  note?: string;
  // Identifier of the chat turn that produced this proposal. Anchors the
  // card visually and lets edit-then-apply re-run dispatch on the same input.
  sourceTurnId: string;
}
