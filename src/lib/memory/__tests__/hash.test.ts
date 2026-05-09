import { describe, expect, it } from 'vitest';

import { hashContent, isSidecarFresh } from '../hash';
import type { Sidecar } from '../types';
import { SIDECAR_SCHEMA_VERSION } from '../types';

describe('hashContent', () => {
  it('produces a stable 64-char hex digest', async () => {
    const hash = await hashContent('hello world');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await hashContent('open brain');
    const b = await hashContent('open brain');
    expect(a).toBe(b);
  });

  it('changes when content changes', async () => {
    const a = await hashContent('open brain');
    const b = await hashContent('open brain ');
    expect(a).not.toBe(b);
  });
});

function makeSidecar(overrides: Partial<Sidecar> = {}): Sidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    source: 'notes/foo.md',
    sourceHash: 'abc',
    extractedAt: 1,
    embeddingModel: 'test',
    embeddings: [],
    ...overrides,
  };
}

describe('isSidecarFresh', () => {
  it('returns true when the hash matches and the schema is current', () => {
    expect(isSidecarFresh('abc', makeSidecar())).toBe(true);
  });

  it('returns false when the hash differs', () => {
    expect(isSidecarFresh('def', makeSidecar({ sourceHash: 'abc' }))).toBe(false);
  });

  it('returns false when the schema version is out of date', () => {
    expect(isSidecarFresh('abc', makeSidecar({ schemaVersion: 0 }))).toBe(false);
  });
});
