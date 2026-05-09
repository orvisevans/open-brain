import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingQueue } from '../embedding-queue';
import { parseSidecar } from '../sidecar-format';

import { createFakeClock, FakeQueueStorage, FakeVault, installFakeEmbedder } from './fakes';

describe('EmbeddingQueue', () => {
  let restoreEmbedder: () => void;

  beforeEach(() => {
    restoreEmbedder = installFakeEmbedder();
  });

  afterEach(() => {
    restoreEmbedder();
  });

  it('debounces multiple enqueues into a single run', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/a.md', 'first note');
    vault.setNote('notes/b.md', 'second note');

    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });

    queue.enqueue('notes/a.md');
    await clock.advance(50);
    queue.enqueue('notes/b.md');
    expect(queue.status.value.state).toBe('waiting');
    expect(queue.status.value.pending).toEqual(['notes/a.md', 'notes/b.md']);

    await clock.advance(150);
    await queue.whenIdle();
    expect(queue.status.value.state).toBe('idle');
    expect(queue.status.value.pending).toEqual([]);
    expect(vault.getSidecar('.memory/notes/a.md')).toBeDefined();
    expect(vault.getSidecar('.memory/notes/b.md')).toBeDefined();
  });

  it('writes a sidecar with embeddings and the source hash', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/x.md', '## Section\n\nbody.');
    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });

    queue.enqueue('notes/x.md');
    await clock.advance(50);
    await queue.whenIdle();

    const raw = vault.getSidecar('.memory/notes/x.md');
    expect(raw).toBeDefined();
    const sidecar = parseSidecar(raw ?? '');
    expect(sidecar.source).toBe('notes/x.md');
    expect(sidecar.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.embeddings.length).toBeGreaterThan(0);
    expect(sidecar.embeddings[0]?.vector.length).toBe(384);
  });

  it('skips notes whose sidecar already matches the current hash', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/x.md', 'body');

    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 1,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    queue.enqueue('notes/x.md');
    await clock.advance(10);
    await queue.whenIdle();
    const firstSidecar = vault.getSidecar('.memory/notes/x.md');

    queue.enqueue('notes/x.md');
    await clock.advance(10);
    await queue.whenIdle();
    const secondSidecar = vault.getSidecar('.memory/notes/x.md');
    // Identical content → identical sidecar (extractedAt unchanged because
    // the run is skipped).
    expect(secondSidecar).toBe(firstSidecar);
  });

  it('persists pending paths after each enqueue', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/a.md', 'body');
    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 1000,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    queue.enqueue('notes/a.md');
    // Save is fire-and-forget; flush microtasks.
    await Promise.resolve();
    expect(storage.embedding).toEqual(['notes/a.md']);
  });

  it('hydrates from persisted state and resumes', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    storage.embedding = ['notes/y.md'];
    const clock = createFakeClock();
    vault.setNote('notes/y.md', 'body');

    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 5,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    await queue.hydrate();
    await clock.advance(50);
    await queue.whenIdle();
    expect(vault.getSidecar('.memory/notes/y.md')).toBeDefined();
  });

  it('records errors per path and keeps the path queued for retry', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    // No note set — readNote will throw.
    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 1,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    queue.enqueue('notes/missing.md');
    await clock.advance(10);
    await queue.whenIdle();
    expect(queue.status.value.state).toBe('error');
    expect(queue.status.value.errors['notes/missing.md']).toBeDefined();
    expect(queue.status.value.pending).toContain('notes/missing.md');
  });

  it('flush() runs immediately, ignoring the debounce', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/a.md', 'body');
    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 60_000,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    queue.enqueue('notes/a.md');
    await queue.flush();
    expect(vault.getSidecar('.memory/notes/a.md')).toBeDefined();
  });

  it('preserves prior LLM extraction fields on re-embed', async () => {
    const vault = new FakeVault();
    const storage = new FakeQueueStorage();
    const clock = createFakeClock();
    vault.setNote('notes/a.md', 'first body');
    const queue = createEmbeddingQueue({
      vault,
      storage,
      debounceMs: 1,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    queue.enqueue('notes/a.md');
    await clock.advance(10);
    await queue.whenIdle();

    // Inject an extraction-augmented sidecar by re-parsing/re-writing.
    const before = parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '');
    const augmented = {
      ...before,
      summary: 'a summary',
      extractionModel: 'gemma-test',
    };
    const { serializeSidecar } = await import('../sidecar-format');
    vault.setSidecar('.memory/notes/a.md', serializeSidecar(augmented));

    // Edit the note → re-embed.
    vault.setNote('notes/a.md', 'second body');
    queue.enqueue('notes/a.md');
    await clock.advance(10);
    await queue.whenIdle();

    const after = parseSidecar(vault.getSidecar('.memory/notes/a.md') ?? '');
    expect(after.summary).toBe('a summary');
    expect(after.extractionModel).toBe('gemma-test');
    // But sourceHash and embeddings are fresh.
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });
});
