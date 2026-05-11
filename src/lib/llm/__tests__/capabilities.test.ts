import { describe, expect, it } from 'vitest';

import { CAPABILITIES_CHAR_CAP, CAPABILITIES_PROMPT, CAPABILITIES_VERSION } from '../capabilities';

describe('CAPABILITIES_PROMPT', () => {
  it('fits inside the token-budget character cap', () => {
    // Phase 5.9 budget: ≤ 350 tokens at 0.3 tok/char ≈ 1500 chars.
    // If this fails, trim the prompt — KV cache reuse and overall budget
    // (capabilities + persona + retrieval guardrails + slash-emit) depend
    // on this slot staying lean.
    expect(CAPABILITIES_PROMPT.length).toBeLessThanOrEqual(CAPABILITIES_CHAR_CAP);
  });

  it('mentions Open Brain by name so the model knows its identity', () => {
    expect(CAPABILITIES_PROMPT).toContain('Open Brain');
  });

  it('lists every shipped slash command', () => {
    // Each slash command from Phase 5.5/5.6/5.7 should appear at least once.
    // If we add a command and forget to update the capabilities, this fails.
    for (const command of [
      '/journal',
      '/note',
      '/save',
      '/append',
      '/list',
      '/find',
      '/related',
      '/edit',
      '/organize',
      '/archive',
      '/tag',
    ]) {
      expect(CAPABILITIES_PROMPT).toContain(command);
    }
  });

  it('mentions the vault directory shape', () => {
    expect(CAPABILITIES_PROMPT).toContain('notes/');
    expect(CAPABILITIES_PROMPT).toContain('journal/');
    expect(CAPABILITIES_PROMPT).toContain('lists/');
    expect(CAPABILITIES_PROMPT).toContain('.chats/');
  });

  it('exposes a version constant so debug surfaces can show it', () => {
    expect(CAPABILITIES_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(CAPABILITIES_VERSION)).toBe(true);
  });
});
