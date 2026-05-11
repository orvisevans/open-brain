import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../system-prompt';

const CAPS = 'CAPABILITIES';
const GUARD = 'GUARDRAILS';
const PERSONA = 'PERSONA';
const SLASH = 'SLASHEMIT';

describe('buildSystemPrompt', () => {
  it('orders capabilities → persona → guardrails → slash-emit', () => {
    const out = buildSystemPrompt({
      capabilities: CAPS,
      persona: PERSONA,
      retrievalGuardrails: GUARD,
      slashEmit: SLASH,
    });
    const indexes = [
      out.prompt.indexOf(CAPS),
      out.prompt.indexOf(PERSONA),
      out.prompt.indexOf(GUARD),
      out.prompt.indexOf(SLASH),
    ];
    expect(indexes.every((pos) => pos !== -1)).toBe(true);
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThan(indexes[index - 1] ?? -1);
    }
  });

  it('omits the persona section when absent', () => {
    const out = buildSystemPrompt({
      capabilities: CAPS,
      retrievalGuardrails: GUARD,
    });
    expect(out.prompt).toContain(CAPS);
    expect(out.prompt).toContain(GUARD);
    expect(out.prompt).not.toContain(PERSONA);
  });

  it('omits the persona section when empty/whitespace', () => {
    const out = buildSystemPrompt({
      capabilities: CAPS,
      persona: '   \n  \n',
      retrievalGuardrails: GUARD,
    });
    expect(out.prompt.split('\n\n')).toHaveLength(2);
  });

  it('omits the slash-emit section when off', () => {
    const out = buildSystemPrompt({
      capabilities: CAPS,
      retrievalGuardrails: GUARD,
    });
    expect(out.prompt).not.toContain(SLASH);
  });

  it('reports approximate tokens', () => {
    const out = buildSystemPrompt({
      capabilities: 'x'.repeat(100),
      retrievalGuardrails: 'y'.repeat(100),
    });
    // 200 chars + 2-char separator = 202, × 0.3 = 60.6 → 61.
    expect(out.approxTokens).toBeGreaterThanOrEqual(60);
    expect(out.approxTokens).toBeLessThanOrEqual(62);
  });
});
