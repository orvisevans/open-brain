import { describe, expect, it } from 'vitest';

import {
  isSidecarPath,
  noteToSidecarPath,
  parseSidecar,
  serializeSidecar,
  sidecarToNotePath,
  SidecarParseError,
} from '../sidecar-format';
import type { Sidecar } from '../types';
import { SIDECAR_SCHEMA_VERSION } from '../types';

function makeSidecar(): Sidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    source: 'notes/foo.md',
    sourceHash: 'abc123',
    extractedAt: 1_700_000_000_000,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    extractionModel: 'gemma-2-2b-it-q4f16_1-MLC',
    embeddings: [
      {
        index: 0,
        text: 'first chunk',
        vector: new Float32Array([0.1, 0.2, 0.3]),
        heading: 'Intro',
        start: 0,
        end: 10,
      },
      {
        index: 1,
        text: 'second chunk',
        vector: new Float32Array([0.4, 0.5, 0.6, 0.7]),
        start: 11,
        end: 22,
      },
    ],
    summary: 'a short note',
    entities: [{ type: 'person', name: 'Alice' }],
    facts: ['fact one', 'fact two'],
    topics: ['intro'],
    links: [{ to: 'notes/bar.md' }, { to: 'notes/baz.md', display: 'baz' }],
  };
}

describe('sidecar path helpers', () => {
  it('converts note ↔ sidecar paths', () => {
    expect(noteToSidecarPath('notes/foo.md')).toBe('.memory/notes/foo.md');
    expect(sidecarToNotePath('.memory/notes/foo.md')).toBe('notes/foo.md');
    expect(sidecarToNotePath('notes/foo.md')).toBeUndefined();
  });

  it('detects sidecar paths', () => {
    expect(isSidecarPath('.memory/notes/x.md')).toBe(true);
    expect(isSidecarPath('notes/x.md')).toBe(false);
  });
});

describe('serializeSidecar / parseSidecar', () => {
  it('round-trips a fully-populated sidecar', () => {
    const original = makeSidecar();
    const serialised = serializeSidecar(original);
    const parsed = parseSidecar(serialised);

    expect(parsed.schemaVersion).toBe(original.schemaVersion);
    expect(parsed.source).toBe(original.source);
    expect(parsed.sourceHash).toBe(original.sourceHash);
    expect(parsed.extractedAt).toBe(original.extractedAt);
    expect(parsed.embeddingModel).toBe(original.embeddingModel);
    expect(parsed.extractionModel).toBe(original.extractionModel);

    expect(parsed.embeddings).toHaveLength(2);
    expect(parsed.embeddings[0]?.text).toBe('first chunk');
    expect(parsed.embeddings[0]?.heading).toBe('Intro');
    expect(parsed.embeddings[0]?.start).toBe(0);
    expect(parsed.embeddings[0]?.end).toBe(10);
    expect([...(parsed.embeddings[0]?.vector ?? [])]).toEqual(
      [0.1, 0.2, 0.3].map((v) => Math.fround(v)),
    );
    expect([...(parsed.embeddings[1]?.vector ?? [])]).toEqual(
      [0.4, 0.5, 0.6, 0.7].map((v) => Math.fround(v)),
    );

    expect(parsed.summary).toBe('a short note');
    expect(parsed.entities).toEqual([{ type: 'person', name: 'Alice' }]);
    expect(parsed.facts).toEqual(['fact one', 'fact two']);
    expect(parsed.topics).toEqual(['intro']);
    expect(parsed.links).toEqual([{ to: 'notes/bar.md' }, { to: 'notes/baz.md', display: 'baz' }]);
  });

  it('round-trips an embedding-only sidecar (no LLM extraction yet)', () => {
    const original: Sidecar = {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      source: 'notes/seed.md',
      sourceHash: 'h',
      extractedAt: 1,
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      embeddings: [
        {
          index: 0,
          text: 't',
          vector: new Float32Array([1, 2]),
          start: 0,
          end: 1,
        },
      ],
    };
    const parsed = parseSidecar(serializeSidecar(original));
    expect(parsed.extractionModel).toBeUndefined();
    expect(parsed.summary).toBeUndefined();
    expect(parsed.entities).toBeUndefined();
  });

  it('throws SidecarParseError on missing frontmatter', () => {
    expect(() => parseSidecar('no frontmatter here')).toThrow(SidecarParseError);
  });

  it('throws SidecarParseError on missing JSON body', () => {
    const bad =
      '---\nschema_version: 1\nsource: notes/foo.md\nsource_hash: a\nextracted_at: 1\nembedding_model: m\n---\n\nno code block';
    expect(() => parseSidecar(bad)).toThrow(SidecarParseError);
  });

  it('throws SidecarParseError on invalid JSON', () => {
    const bad =
      '---\nschema_version: 1\nsource: notes/foo.md\nsource_hash: a\nextracted_at: 1\nembedding_model: m\n---\n\n```json\n{not valid}\n```\n';
    expect(() => parseSidecar(bad)).toThrow(SidecarParseError);
  });

  it('preserves Float32Array bit-exactness through base64', () => {
    // Use values that survive Math.fround so we can compare exactly.
    const original = new Float32Array([0, -1, 3.5, 1024.125]);
    const sidecar: Sidecar = {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      source: 'notes/x.md',
      sourceHash: 'h',
      extractedAt: 1,
      embeddingModel: 'm',
      embeddings: [{ index: 0, text: 't', vector: original, start: 0, end: 0 }],
    };
    const parsed = parseSidecar(serializeSidecar(sidecar));
    expect(parsed.embeddings[0]?.vector).toBeInstanceOf(Float32Array);
    expect([...(parsed.embeddings[0]?.vector ?? [])]).toEqual([...original]);
  });
});
