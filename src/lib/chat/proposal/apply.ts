// Proposal application — single seam where every Phase 5.5 write goes
// through the existing vault pipeline. The proposal card calls this on
// Apply; nothing else writes.
//
// Idempotency note: the UI prevents double-apply by removing the card from
// view on success. We don't track applied IDs centrally — a re-apply would
// just re-write the same `finalContent`, which is a no-op at the file level.

import type { NotePath } from '$lib/vault/types';

import type { Proposal } from './types';

export interface ProposalVault {
  writeNote(path: NotePath, content: string): Promise<void>;
}

export async function applyProposal(proposal: Proposal, vault: ProposalVault): Promise<void> {
  await vault.writeNote(proposal.target, proposal.finalContent);
}
