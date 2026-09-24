import { describe, expect, it } from 'bun:test';
import { ProjectBrowserLock, ProjectBrowserLocks, type Holder } from './lock';

const agentA: Holder = { kind: 'agent', agentId: 1, agentName: 'Writer' };
const agentB: Holder = { kind: 'agent', agentId: 2, agentName: 'Coder' };
const owner: Holder = { kind: 'owner' };

describe('ProjectBrowserLock', () => {
  it('is free until something acquires it', () => {
    const lock = new ProjectBrowserLock(120_000);
    expect(lock.state().holder).toBeNull();
  });

  it('an agent acquires a free lock immediately', async () => {
    const lock = new ProjectBrowserLock(120_000);
    const result = await lock.acquire(agentA, 5);
    expect(result).toEqual({ acquired: true, blockedBy: null });
    expect(lock.state().holder).toEqual(agentA);
  });

  it('re-acquiring by the same holder succeeds and does not queue', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    const again = await lock.acquire(agentA, 5);
    expect(again).toEqual({ acquired: true, blockedBy: null });
  });

  it('a second agent waits and reports who is blocking when it gives up (timeoutSec 0)', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    const result = await lock.acquire(agentB, 0);
    expect(result.acquired).toBe(false);
    expect(result.blockedBy).toEqual(agentA);
  });

  it('a waiting agent acquires the lock, FIFO, once it is released', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    const waiting = lock.acquire(agentB, 5);
    // Give the waiter's promise a tick to register before releasing.
    await new Promise((r) => setTimeout(r, 10));
    expect(lock.release(agentA)).toBe(true);
    const result = await waiting;
    expect(result.acquired).toBe(true);
    expect(lock.state().holder).toEqual(agentB);
  });

  it('only the holder can release its own lock', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    expect(lock.release(agentB)).toBe(false);
    expect(lock.state().holder).toEqual(agentA);
  });

  it('Übernehmen always wins immediately, whoever holds it', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    lock.takeover();
    expect(lock.state().holder).toEqual(owner);
  });

  it("the owner's hold does not expire on the agent timeout", () => {
    let now = 0;
    const lock = new ProjectBrowserLock(100, () => now);
    lock.takeover();
    now += 10_000; // far past the 100ms agent timeout
    expect(lock.state().holder).toEqual(owner);
  });

  it('an agent lock expires after the configured timeout with no action', async () => {
    let now = 0;
    const lock = new ProjectBrowserLock(100, () => now);
    await lock.acquire(agentA, 5);
    now += 101;
    expect(lock.state().holder).toBeNull();
  });

  it('touch() keeps an agent lock alive across the timeout window', async () => {
    let now = 0;
    const lock = new ProjectBrowserLock(100, () => now);
    await lock.acquire(agentA, 5);
    now += 60;
    expect(lock.touch(agentA)).toBe(true);
    now += 60; // 120 total, but only 60 since the last touch
    expect(lock.state().holder).toEqual(agentA);
  });

  it('touch() refuses a holder that does not currently hold the lock', async () => {
    const lock = new ProjectBrowserLock(120_000);
    await lock.acquire(agentA, 5);
    expect(lock.touch(agentB)).toBe(false);
  });

  it('release() on a lock nothing ever acquired is a no-op, not an error', () => {
    const lock = new ProjectBrowserLock(100);
    expect(lock.release(agentA)).toBe(false);
  });
});

describe('ProjectBrowserLocks', () => {
  it('gives each project slug its own independent lock', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    await locks.of('mkt').acquire(agentA, 5);
    expect(locks.of('ops').state().holder).toBeNull();
    expect(locks.of('mkt').state().holder).toEqual(agentA);
  });

  it('returns the same lock instance for the same slug', () => {
    const locks = new ProjectBrowserLocks(120_000);
    expect(locks.of('mkt')).toBe(locks.of('mkt'));
  });
});
