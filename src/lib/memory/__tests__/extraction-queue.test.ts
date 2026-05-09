import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExtractionQueue, type ExtractionLLM } from '../extraction-queue';
import { createGpuLease } from '../gpu-lease';
import { parseSidecar, serializeSidecar } from '../sidecar-format';
import type { Sidecar } from '../types';
import { SIDECAR_SCHEMA_VERSION } from '../types';

import { createFakeClock, FakeVault, installFakeEmbedder } from './fakes';

function makeSeededSidecar(): Sidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    source: 'notes/a.md',
    sourceHash: 'h',
    extractedAt: 1,
    embeddingModel: 'test',
    embeddings: [
      {
        index: 0,
        text: 'note text',
        vector: new Float32Array(384),
        start: 0,
        end: 9,
      },
    ],
  };
}

function makeLlm(response: string, model = 'gemma-test'): ExtractionLLM {
  return {
    modelId: () => model,
    complete: () => Promise.resolve(response),
  };
}

describe('ExtractionQueue', () => {
  let restoreEmbedder: () => void;
  beforeEach(() => {
    restoreEmbedder = installFakeEmbedder();
  });
  afterEach(() => {
    restoreEmbedder();
  });

  it('skips when user is busy', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => false, isBatteryOk: () => true },
      llm: makeLlm('{"summary":"s","entities":[],"facts":[],"topics":[]}'),
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();
    expect(queue.status.value.state).toBe('paused');
    expect(queue.status.value.pauseReason).toBe('busy-user');
    expect(parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '').summary).toBeUndefined();
    queue.stop();
  });

  it('skips when battery is low', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => true, isBatteryOk: () => false },
      llm: makeLlm('{"summary":"s","entities":[],"facts":[],"topics":[]}'),
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();
    expect(queue.status.value.pauseReason).toBe('battery');
    queue.stop();
  });

  it('processes when all gates pass and writes summary/entities to sidecar', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const llmResponse = JSON.stringify({
      summary: 'hello',
      entities: [{ type: 'person', name: 'Alice' }],
      facts: ['fact1'],
      topics: ['topic'],
    });
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => true, isBatteryOk: () => true },
      llm: makeLlm(llmResponse),
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();

    const sidecar = parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '');
    expect(sidecar.summary).toBe('hello');
    expect(sidecar.entities).toEqual([{ type: 'person', name: 'Alice' }]);
    expect(sidecar.facts).toEqual(['fact1']);
    expect(sidecar.extractionModel).toBe('gemma-test');
    queue.stop();
  });

  it('flush() bypasses gates', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => false, isBatteryOk: () => false },
      llm: makeLlm('{"summary":"forced","entities":[],"facts":[],"topics":[]}'),
      tickMs: 10_000,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await queue.flush();
    expect(parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '').summary).toBe('forced');
    queue.stop();
  });

  it('pauses when GPU lease is held by chat', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const lease = createGpuLease();
    const release = await lease.acquire('chat');
    const queue = createExtractionQueue({
      vault,
      gpuLease: lease,
      gates: { isUserIdle: () => true, isBatteryOk: () => true },
      llm: makeLlm('{"summary":"s","entities":[],"facts":[],"topics":[]}'),
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();
    expect(queue.status.value.pauseReason).toBe('gpu-busy');
    expect(parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '').summary).toBeUndefined();
    release();
    queue.stop();
  });

  it('skips when sidecar is missing (waiting for embedding queue)', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    // No sidecar.

    const clock = createFakeClock();
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => true, isBatteryOk: () => true },
      llm: makeLlm('{"summary":"s","entities":[],"facts":[],"topics":[]}'),
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();
    expect(vault.getSidecar('.memory/notes/a.md')).toBeUndefined();
    expect(queue.status.value.state).toBe('idle');
    queue.stop();
  });

  it('pauses with no-llm when modelId() is undefined', async () => {
    const vault = new FakeVault();
    vault.setNote('notes/a.md', 'body');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(makeSeededSidecar()));

    const clock = createFakeClock();
    const queue = createExtractionQueue({
      vault,
      gpuLease: createGpuLease(),
      gates: { isUserIdle: () => true, isBatteryOk: () => true },
      llm: { modelId: () => undefined as string | undefined, complete: () => Promise.resolve('') },
      tickMs: 10,
      setIntervalImpl: clock.setInterval,
      clearIntervalImpl: clock.clearInterval,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(20);
    await queue.whenIdle();
    expect(queue.status.value.pauseReason).toBe('no-llm');
    queue.stop();
  });
});
