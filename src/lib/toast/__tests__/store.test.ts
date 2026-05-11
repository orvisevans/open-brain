import { describe, expect, it } from 'vitest';

import { createToastStore } from '../store';

const noop = (): void => undefined;

function buildClock(): {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  advance: (ms: number) => Promise<void>;
  nowFn: () => number;
} {
  let time = 0;
  const pending: { fireAt: number; handler: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    setTimeout: (handler, ms) => {
      const entry = { fireAt: time + ms, handler, id: nextId };
      nextId += 1;
      pending.push(entry);
      return entry.id;
    },
    clearTimeout: (handle) => {
      const index = pending.findIndex((p) => p.id === handle);
      if (index !== -1) pending.splice(index, 1);
    },
    advance: (ms) => {
      time += ms;
      const due = pending.filter((p) => p.fireAt <= time).sort((a, b) => a.fireAt - b.fireAt);
      for (const entry of due) {
        const index = pending.indexOf(entry);
        if (index !== -1) pending.splice(index, 1);
        entry.handler();
      }
      return Promise.resolve();
    },
    nowFn: () => time,
  };
}

describe('toast store', () => {
  it('pushes a toast and auto-dismisses after the configured window', async () => {
    const clock = buildClock();
    const store = createToastStore({
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    store.show({ message: 'something broke' });
    expect(store.value).toHaveLength(1);
    await clock.advance(150);
    expect(store.value).toHaveLength(0);
  });

  it('collapses duplicate messages within the collapse window', async () => {
    const clock = buildClock();
    const store = createToastStore({
      collapseWindowMs: 1000,
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    store.show({ message: 'sync failed' });
    await clock.advance(50);
    store.show({ message: 'sync failed' });
    expect(store.value).toHaveLength(1);
    expect(store.value[0]?.count).toBe(2);
  });

  it('does not collapse when severity differs', () => {
    const clock = buildClock();
    const store = createToastStore({
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    store.show({ message: 'x', severity: 'warn' });
    store.show({ message: 'x', severity: 'error' });
    expect(store.value).toHaveLength(2);
  });

  it('does not collapse toasts that carry an action', () => {
    const clock = buildClock();
    const store = createToastStore({
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    const action = { label: 'retry', onClick: noop };
    store.show({ message: 'sign in', action });
    store.show({ message: 'sign in', action });
    expect(store.value).toHaveLength(2);
  });

  it('refreshes the dismiss timer on a duplicate', async () => {
    const clock = buildClock();
    const store = createToastStore({
      collapseWindowMs: 1000,
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    store.show({ message: 'spam' });
    await clock.advance(80);
    store.show({ message: 'spam' });
    // Without refresh the toast would dismiss at t=100. With refresh,
    // dismissal happens at t=80+100=180.
    await clock.advance(50);
    expect(store.value).toHaveLength(1);
    await clock.advance(80);
    expect(store.value).toHaveLength(0);
  });

  it('keeps actionable toasts past the auto-dismiss window', async () => {
    const clock = buildClock();
    const store = createToastStore({
      autoDismissMs: 100,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    store.show({ message: 'sign in', action: { label: 'sign in', onClick: noop } });
    await clock.advance(500);
    expect(store.value).toHaveLength(1);
  });

  it('manual dismiss removes the toast', () => {
    const clock = buildClock();
    const store = createToastStore({
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    const id = store.show({ message: 'whatever' });
    store.dismiss(id);
    expect(store.value).toHaveLength(0);
  });

  it('notifies subscribers on every change', () => {
    const clock = buildClock();
    const store = createToastStore({
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      now: clock.nowFn,
    });
    const snapshots: number[] = [];
    const unsubscribe = store.subscribe((toasts) => {
      snapshots.push(toasts.length);
    });
    store.show({ message: 'a' });
    store.show({ message: 'b' });
    unsubscribe();
    store.show({ message: 'c' });
    expect(snapshots).toEqual([0, 1, 2]);
  });
});
