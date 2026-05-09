// SyncEngine unit tests. Use a fake clock + a fake setTimeout so we can
// drive the debounce deterministically. Network and isomorphic-git are
// behind the GitOps boundary; fake injected.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyncEngine } from '../engine';
import type { GitAuthor, SyncEngine } from '../types';

import { createFakeGitOps, type FakeGitOps } from './fake-git-ops';

const AUTHOR: GitAuthor = { name: 'tester', email: 'tester@example.test' };

interface Harness {
  engine: SyncEngine;
  ops: FakeGitOps;
  clock: FakeClock;
  online: { value: boolean };
}

class FakeClock {
  private current = 1_000_000;
  private nextHandle = 1;
  private readonly timers = new Map<number, { fireAt: number; handler: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout = (handler: () => void, ms: number): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { fireAt: this.current + ms, handler });
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    if (typeof handle === 'number') {
      this.timers.delete(handle);
    }
  };

  advance(ms: number): void {
    this.current += ms;
    const due: { fireAt: number; handler: () => void }[] = [];
    for (const [handle, timer] of this.timers) {
      if (timer.fireAt <= this.current) {
        due.push(timer);
        this.timers.delete(handle);
      }
    }
    due.sort((a, b) => a.fireAt - b.fireAt);
    for (const timer of due) timer.handler();
  }
}

// Sentinel for "signed out" — `undefined` collides with "key not specified".
const SIGNED_OUT = Symbol('signed-out');

function createHarness(
  overrides: {
    token?: string | typeof SIGNED_OUT;
    online?: boolean;
  } = {},
): Harness {
  const ops = createFakeGitOps();
  const clock = new FakeClock();
  const online = { value: overrides.online ?? true };
  const resolvedToken: string | undefined =
    overrides.token === SIGNED_OUT ? undefined : (overrides.token ?? 'fake-token');
  const engine = createSyncEngine({
    ops,
    getToken: () => resolvedToken,
    getAuthor: () => AUTHOR,
    isOnline: () => online.value,
    debounceMs: 5000,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    nowImpl: () => clock.now(),
  });
  return { engine, ops, clock, online };
}

async function flush(): Promise<void> {
  // Allow queued microtasks (the runFlush async fn) to settle. The push-
  // rejection recovery path stacks pull + retry-push so a few cycles
  // aren't enough; 16 yields is plenty for any chain we currently have.
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence engine-level error logs for negative-path tests.
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // Silence the engine's diagnostic pull/push logs.
    });
  });

  describe('debounced commit + push', () => {
    it('coalesces multiple changes into a single commit', async () => {
      const { engine, ops, clock } = createHarness();

      engine.notifyChange('notes/a.md');
      engine.notifyChange('notes/b.md');
      engine.notifyChange('notes/a.md'); // duplicate path — should still be one stage entry

      expect(ops.calls.commit).toHaveLength(0);

      clock.advance(4999);
      await flush();
      expect(ops.calls.commit).toHaveLength(0);

      clock.advance(1);
      await flush();

      expect(ops.calls.stage).toHaveLength(1);
      expect(ops.calls.stage[0]?.sort()).toEqual(['notes/a.md', 'notes/b.md']);
      expect(ops.calls.commit).toHaveLength(1);
      expect(ops.calls.push).toEqual(['fake-token']);
    });

    it('resets the debounce timer when new changes arrive', async () => {
      const { engine, ops, clock } = createHarness();

      engine.notifyChange('notes/a.md');
      clock.advance(4000);
      // New change before the original timer fires — extends the window.
      engine.notifyChange('notes/b.md');
      clock.advance(4000);
      await flush();

      expect(ops.calls.commit).toHaveLength(0);

      clock.advance(1000);
      await flush();
      expect(ops.calls.commit).toHaveLength(1);
    });

    it('emits a sequence: pending → syncing(commit) → syncing(push) → idle', async () => {
      const { engine, clock } = createHarness();

      const seen: string[] = [];
      engine.subscribe((status) => {
        seen.push(status.kind === 'syncing' ? `syncing:${status.phase}` : status.kind);
      });

      engine.notifyChange('notes/a.md');
      clock.advance(5000);
      await flush();

      // Initial idle is emitted by subscribe(), then pending, then the syncing
      // phases, then idle again on success.
      expect(seen).toEqual(['idle', 'pending', 'syncing:commit', 'syncing:push', 'idle']);
    });
  });

  describe('flush()', () => {
    it('forces an immediate commit, ignoring the debounce', async () => {
      const { engine, ops, clock } = createHarness();
      engine.notifyChange('notes/a.md');
      clock.advance(100);
      await engine.flush();
      expect(ops.calls.commit).toHaveLength(1);
    });

    it('is a no-op with no pending changes', async () => {
      const { engine, ops } = createHarness();
      await engine.flush();
      expect(ops.calls.commit).toHaveLength(0);
    });
  });

  describe('offline behaviour', () => {
    it('does not push while offline; queues paths until back online', async () => {
      const { engine, ops, clock, online } = createHarness({ online: false });

      engine.notifyChange('notes/a.md');
      expect(engine.status.value.kind).toBe('offline');

      clock.advance(10_000);
      await flush();
      expect(ops.calls.commit).toHaveLength(0);

      online.value = true;
      // The engine doesn't poll for online flips itself — the consumer is
      // expected to call flush() when the navigator.onLine event fires.
      await engine.flush();
      expect(ops.calls.commit).toHaveLength(1);
    });

    it('does not push when signed out', async () => {
      const { engine, ops, clock } = createHarness({ token: SIGNED_OUT });
      engine.notifyChange('notes/a.md');
      clock.advance(5000);
      await flush();
      expect(ops.calls.push).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('re-queues paths on push failure and surfaces an error status', async () => {
      const { engine, ops, clock } = createHarness();
      ops.pushImpl = () => Promise.reject(new Error('boom'));

      engine.notifyChange('notes/a.md');
      clock.advance(5000);
      await flush();

      expect(engine.status.value.kind).toBe('error');

      // Recover: subsequent flush after the impl is fixed picks up the path again.
      ops.pushImpl = () => Promise.resolve({ kind: 'ok' as const });
      await engine.flush();

      expect(ops.calls.push.filter((t) => t === 'fake-token')).toHaveLength(2);
    });

    it('auto-recovers from a non-fast-forward push by pulling and re-pushing', async () => {
      const { engine, ops, clock } = createHarness();

      // First push: rejected. After the rejection, pullImpl simulates a
      // clean merge that advances HEAD. Then the engine re-pushes; we
      // flip pushImpl to ok at that point.
      let pushCount = 0;
      ops.pushImpl = () => {
        pushCount += 1;
        if (pushCount === 1) {
          return Promise.resolve({ kind: 'rejected-non-fast-forward' as const });
        }
        return Promise.resolve({ kind: 'ok' as const });
      };
      ops.pullImpl = () => {
        ops.currentHead = 'oid-after-pull';
        return Promise.resolve({ kind: 'merged' as const });
      };

      engine.notifyChange('notes/a.md');
      clock.advance(5000);
      await flush();

      expect(ops.calls.push).toHaveLength(2);
      expect(ops.calls.pull).toHaveLength(1);
      expect(engine.status.value.kind).toBe('idle');
    });

    it('surfaces conflict (not error) when push-rejection recovery hits overlapping changes', async () => {
      const { engine, ops, clock } = createHarness();
      ops.pushImpl = () => Promise.resolve({ kind: 'rejected-non-fast-forward' as const });
      ops.pullImpl = () =>
        Promise.resolve({ kind: 'conflict' as const, conflictPaths: ['notes/a.md'] });

      engine.notifyChange('notes/a.md');
      clock.advance(5000);
      await flush();

      // Only one push attempt — we don't retry while the user has to
      // resolve a conflict.
      expect(ops.calls.push).toHaveLength(1);
      expect(engine.status.value.kind).toBe('conflict');
    });
  });

  describe('pull()', () => {
    it('emits conflict status when the merge yields conflict markers', async () => {
      const { engine, ops } = createHarness();
      ops.pullImpl = () =>
        Promise.resolve({ kind: 'conflict' as const, conflictPaths: ['notes/x.md'] });

      await engine.pull();
      expect(engine.status.value).toMatchObject({ kind: 'conflict', paths: ['notes/x.md'] });
    });

    it('clears prior conflicts on a clean merge', async () => {
      const { engine, ops } = createHarness();
      ops.pullImpl = () =>
        Promise.resolve({ kind: 'conflict' as const, conflictPaths: ['notes/x.md'] });
      await engine.pull();
      expect(engine.status.value.kind).toBe('conflict');

      ops.pullImpl = () => Promise.resolve({ kind: 'merged' as const });
      await engine.pull();
      expect(engine.status.value.kind).toBe('idle');
    });
  });

  describe('onRemoteChange()', () => {
    it('fires when pull advances HEAD', async () => {
      const { engine, ops } = createHarness();
      const events: number[] = [];
      engine.onRemoteChange(() => events.push(1));

      // Default pullImpl returns up-to-date; advance HEAD before the next call
      // to simulate a real merge landing.
      ops.pullImpl = () => {
        ops.currentHead = 'oid-after';
        return Promise.resolve({ kind: 'merged' as const });
      };
      await engine.pull();
      expect(events).toHaveLength(1);
    });

    it('does not fire when pull is a no-op (HEAD unchanged)', async () => {
      const { engine, ops } = createHarness();
      const events: number[] = [];
      engine.onRemoteChange(() => events.push(1));

      // pullImpl returns up-to-date and leaves HEAD untouched.
      ops.pullImpl = () => Promise.resolve({ kind: 'up-to-date' as const });
      await engine.pull();
      expect(events).toHaveLength(0);
    });

    it('fires on conflict outcome (working tree was rewritten with markers)', async () => {
      const { engine, ops } = createHarness();
      const events: number[] = [];
      engine.onRemoteChange(() => events.push(1));
      ops.pullImpl = () =>
        Promise.resolve({ kind: 'conflict' as const, conflictPaths: ['notes/x.md'] });
      await engine.pull();
      expect(events).toHaveLength(1);
    });

    it('returns an unsubscribe function', async () => {
      const { engine, ops } = createHarness();
      const events: number[] = [];
      const unsubscribe = engine.onRemoteChange(() => events.push(1));
      ops.pullImpl = () => {
        ops.currentHead = `oid-${String(events.length)}`;
        return Promise.resolve({ kind: 'merged' as const });
      };
      await engine.pull();
      expect(events).toHaveLength(1);
      unsubscribe();
      await engine.pull();
      expect(events).toHaveLength(1);
    });
  });

  describe('markResolved()', () => {
    it('clears the conflict and queues the file for re-commit', async () => {
      const { engine, ops, clock } = createHarness();
      ops.pullImpl = () =>
        Promise.resolve({ kind: 'conflict' as const, conflictPaths: ['notes/x.md'] });
      await engine.pull();

      engine.markResolved('notes/x.md');
      expect(engine.status.value.kind).toBe('pending');

      clock.advance(5000);
      await flush();
      expect(ops.calls.commit).toHaveLength(1);
    });
  });
});
