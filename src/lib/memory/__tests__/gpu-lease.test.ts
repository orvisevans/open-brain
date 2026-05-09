import { describe, expect, it } from 'vitest';

import { createGpuLease } from '../gpu-lease';

describe('GpuLease', () => {
  it('grants the lease immediately when free', async () => {
    const lease = createGpuLease();
    const release = await lease.acquire('chat');
    expect(lease.isContended()).toBe(true);
    release();
    expect(lease.isContended()).toBe(false);
  });

  it('serialises concurrent acquisitions in arrival order', async () => {
    const lease = createGpuLease();
    const order: string[] = [];
    const aRelease = await lease.acquire('chat');
    order.push('a-acquired');

    const bPromise = lease.acquire('extract').then((release) => {
      order.push('b-acquired');
      release();
      return 'done';
    });
    const cPromise = lease.acquire('extract').then((release) => {
      order.push('c-acquired');
      release();
      return 'done';
    });

    aRelease();
    await bPromise;
    await cPromise;
    expect(order).toEqual(['a-acquired', 'b-acquired', 'c-acquired']);
  });

  it('tryAcquire returns undefined when busy', async () => {
    const lease = createGpuLease();
    const release = await lease.acquire('chat');
    expect(lease.tryAcquire('extract')).toBeUndefined();
    release();
    const success = lease.tryAcquire('extract');
    expect(success).toBeDefined();
    success?.();
  });

  it('tryAcquire returns undefined when waiters are queued', async () => {
    const lease = createGpuLease();
    const release = await lease.acquire('chat');
    void lease.acquire('extract');
    expect(lease.tryAcquire('chat')).toBeUndefined();
    release();
  });
});
