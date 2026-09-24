// The control lock (design §5): one holder per project browser at a time, "agent:<id>" or
// "owner". Lives in the router process's memory — design §3 explains why: the router already
// holds the CDP connection, the window keeper and the live view's state, and a lock that
// lived anywhere else (a second process, Postgres) would just race it. Plan's DB only ever
// sees a snapshot of this for the Aktivität feed (recordBrowserGatewayEvent), never the lock
// itself.

export type Holder = { kind: 'agent'; agentId: number; agentName: string } | { kind: 'owner' };

export interface LockState {
  holder: Holder | null;
  since: number | null; // epoch ms
  lastActionAt: number | null;
}

interface Waiter {
  holder: Holder;
  resolve: (acquired: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function sameHolder(a: Holder, b: Holder): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'agent' && b.kind === 'agent' ? a.agentId === b.agentId : true;
}

// One per project browser (including "home"). agentTimeoutMs is the project's
// lockTimeoutSec setting (design §5 default 120s: "Nach 120 s ohne Aktion verfällt die
// Sperre eines Agenten"). The owner's hold never expires here: the live view asks after 10
// minutes without input whether the owner is done and releases it itself.
//
// `onChange` is told every time the holder changes — acquired, handed to a waiter,
// released, taken over or expired — so the live view's "Steuert: …" banner and a waiting
// handover (see server.ts) follow the lock instead of polling it.
export class ProjectBrowserLock {
  #holder: Holder | null = null;
  #since: number | null = null;
  #lastActionAt: number | null = null;
  #waiters: Waiter[] = [];
  #agentTimeoutMs: number;
  #now: () => number;
  #onChange: (state: LockState) => void;

  constructor(
    agentTimeoutMs: number,
    now: () => number = Date.now,
    onChange: (state: LockState) => void = () => {},
  ) {
    this.#agentTimeoutMs = agentTimeoutMs;
    this.#now = now;
    this.#onChange = onChange;
  }

  setAgentTimeoutMs(ms: number): void {
    this.#agentTimeoutMs = ms;
  }

  #snapshot(): LockState {
    return { holder: this.#holder, since: this.#since, lastActionAt: this.#lastActionAt };
  }

  #changed(): void {
    try {
      this.#onChange(this.#snapshot());
    } catch {
      // A listener's failure never breaks the lock itself.
    }
  }

  #expireIfStale(): void {
    if (this.#holder?.kind !== 'agent' || this.#lastActionAt === null) return;
    if (this.#now() - this.#lastActionAt > this.#agentTimeoutMs) this.#releaseInternal();
  }

  state(): LockState {
    this.#expireIfStale();
    return this.#snapshot();
  }

  // Called on every action the holder takes, agent or owner, so the timeout window keeps
  // sliding while work is actually happening.
  touch(holder: Holder): boolean {
    this.#expireIfStale();
    if (!this.#holder || !sameHolder(this.#holder, holder)) return false;
    this.#lastActionAt = this.#now();
    return true;
  }

  #settle(holder: Holder): void {
    this.#holder = holder;
    this.#since = this.#now();
    this.#lastActionAt = this.#since;
  }

  #releaseInternal(): void {
    this.#holder = null;
    this.#since = null;
    this.#lastActionAt = null;
    const waiter = this.#waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#settle(waiter.holder);
      waiter.resolve(true);
    }
    this.#changed();
  }

  // Acquires immediately if free or already held by this holder; otherwise waits up to
  // timeoutSec (FIFO among waiters) and reports who is blocking if it gives up.
  async acquire(
    holder: Holder,
    timeoutSec: number,
  ): Promise<{ acquired: boolean; blockedBy: Holder | null }> {
    this.#expireIfStale();
    if (!this.#holder || sameHolder(this.#holder, holder)) {
      const fresh = !this.#holder;
      if (fresh) this.#settle(holder);
      else this.#lastActionAt = this.#now();
      if (fresh) this.#changed();
      return { acquired: true, blockedBy: null };
    }
    const blockedBy = this.#holder;
    if (timeoutSec <= 0) return { acquired: false, blockedBy };
    // A holder already waiting is not queued twice; it waits on its first place in line.
    this.#waiters = this.#waiters.filter((waiter) => {
      if (!sameHolder(waiter.holder, holder)) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(false);
      return false;
    });
    const acquired = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((w) => w.resolve !== resolve);
        resolve(false);
      }, timeoutSec * 1000);
      this.#waiters.push({ holder, resolve, timer });
    });
    return { acquired, blockedBy: acquired ? null : this.#holder };
  }

  // "Zurückgeben" / an agent finishing its turn. A holder can only release its own lock;
  // the owner's "Übernehmen" is takeover(), not a release of the agent first.
  release(holder: Holder): boolean {
    this.#expireIfStale();
    if (!this.#holder || !sameHolder(this.#holder, holder)) return false;
    this.#releaseInternal();
    return true;
  }

  // "Übernehmen": the owner always wins immediately, whoever holds it (design §5). An
  // agent mid-wait for the lock keeps waiting — it is not rejected, just still blocked,
  // now by the owner.
  takeover(): void {
    if (this.#holder?.kind === 'owner') {
      this.#lastActionAt = this.#now();
      return;
    }
    this.#settle({ kind: 'owner' });
    this.#changed();
  }

  // Expires a stale agent hold now, so a listener hears about it without anyone asking.
  sweep(): void {
    this.#expireIfStale();
  }
}

export type LockListener = (slug: string, state: LockState) => void;

export class ProjectBrowserLocks {
  #locks = new Map<string, ProjectBrowserLock>();
  #listeners = new Set<LockListener>();
  #defaultTimeoutMs: number;
  #now: () => number;

  constructor(defaultTimeoutMs = 120_000, now: () => number = Date.now) {
    this.#defaultTimeoutMs = defaultTimeoutMs;
    this.#now = now;
  }

  // Returns the function that removes the listener again.
  onChange(listener: LockListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  of(slug: string, timeoutMs = this.#defaultTimeoutMs): ProjectBrowserLock {
    let lock = this.#locks.get(slug);
    if (!lock) {
      lock = new ProjectBrowserLock(timeoutMs, this.#now, (state) => {
        for (const listener of [...this.#listeners]) {
          try {
            listener(slug, state);
          } catch {
            // One listener's failure never keeps the others from hearing the change.
          }
        }
      });
      this.#locks.set(slug, lock);
    } else {
      lock.setAgentTimeoutMs(timeoutMs);
    }
    return lock;
  }

  // The lock of a slug if one was ever created, without creating it.
  peek(slug: string): ProjectBrowserLock | undefined {
    return this.#locks.get(slug);
  }

  sweep(): void {
    for (const lock of this.#locks.values()) lock.sweep();
  }

  all(): Map<string, ProjectBrowserLock> {
    return this.#locks;
  }
}
