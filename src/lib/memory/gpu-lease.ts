// `GpuLease` — single-slot lock to coordinate WebGPU users.
//
// Both the LLMRuntime (chat token streaming) and the LLM extraction queue need
// the model loaded in VRAM. Running them concurrently risks OOM on 4 GB-VRAM
// devices. The lease grants serial access; chat takes priority over the
// extraction queue (it `acquire`s eagerly; the queue only runs when the lease
// is free AND no chat acquisition has been waiting).
//
// Reference: ARCHITECTURE-2026-04-17 §475 (VRAM / memory pressure).

export type LeaseHolder = 'chat' | 'extract';

export interface GpuLease {
  /**
   * Acquire the lease. Resolves once the lease is granted; subsequent callers
   * queue. Each acquisition returns a release function.
   */
  acquire(holder: LeaseHolder): Promise<() => void>;
  /**
   * True if the lease is currently held or has waiters. Used by the
   * extraction queue to bail early without joining the wait queue.
   */
  isContended(): boolean;
  /**
   * Try to acquire immediately. Returns the release function if the lease is
   * free, or `undefined` if it would have to wait.
   */
  tryAcquire(holder: LeaseHolder): (() => void) | undefined;
}

interface Waiter {
  holder: LeaseHolder;
  resolve: (release: () => void) => void;
}

export function createGpuLease(): GpuLease {
  let holder: LeaseHolder | undefined;
  const waiters: Waiter[] = [];

  function release(): void {
    holder = undefined;
    const next = waiters.shift();
    if (next === undefined) return;
    holder = next.holder;
    next.resolve(release);
  }

  function acquire(requestor: LeaseHolder): Promise<() => void> {
    if (holder === undefined) {
      holder = requestor;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      waiters.push({ holder: requestor, resolve });
    });
  }

  function tryAcquire(requestor: LeaseHolder): (() => void) | undefined {
    if (holder !== undefined || waiters.length > 0) return undefined;
    holder = requestor;
    return release;
  }

  function isContended(): boolean {
    return holder !== undefined || waiters.length > 0;
  }

  return { acquire, tryAcquire, isContended };
}
