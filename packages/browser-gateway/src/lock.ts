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

function sameHolder(a: Holder, b: Holder): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'agent' && b.kind === 'agent' ? a.agentId === b.agentId : true;
}

// One per project browser (including "home"). agentTimeoutMs is the project's
// lockTimeoutSec setting (design §5 default 120s: "Nach 120 s ohne Aktion verfällt die
// Sperre eines Agenten"); ownerIdleMs is the fixed 10 minutes design §5 gives the owner
// before the live view asks whether they are done.
export class ProjectBrowserLock {
  #holder: Holder | null = null;
  #since: number | null = null;
  #lastActionAt: number | null = null;
  #waiters: Waiter[] = [];
  #agentTimeoutMs: number;
  #now: () => number;

  constructor(agentTimeoutMs: number, now: () => number = Date.now) {
    this.#agentTimeoutMs = agentTimeoutMs;
    this.#now = now;
  }

  setAgentTimeoutMs(ms: number): void {
    this.#agentTimeoutMs = ms;
  }

  #expireIfStale(): void {
    // Only an agent's hold expires on its own; the owner's is released explicitly
    // ("Zurückgeben") or by the live view's 10-minute idle prompt, which is UI-driven and
    // calls release() itself rather than this timer.
    if (this.#holder?.kind !== 'agent' || this.#lastActionAt === null) return;
    if (this.#now() - this.#lastActionAt > this.#agentTimeoutMs) this.#releaseInternal();
  }

  state(): LockState {
    this.#expireIfStale();
    return { holder: this.#holder, since: this.#since, lastActionAt: this.#lastActionAt };
  }

  // Called on every action the holder takes, agent or owner, so the 120s window keeps
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
  }

  // Acquires immediately if free or already held by this holder; otherwise waits up to
  // timeoutSec (FIFO among waiters) and reports who is blocking if it gives up.
  async acquire(
    holder: Holder,
    timeoutSec: number,
  ): Promise<{ acquired: boolean; blockedBy: Holder | null }> {
    this.#expireIfStale();
    if (!this.#holder || sameHolder(this.#holder, holder)) {
      this.#settle(holder);
      return { acquired: true, blockedBy: null };
    }
    const blockedBy = this.#holder;
    if (timeoutSec <= 0) return { acquired: false, blockedBy };
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
  // the owner's "Übernehmen" is acquire(), not a release of the agent first — see
  // takeover().
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
    this.#holder = null;
    this.#since = null;
    this.#lastActionAt = null;
    this.#settle({ kind: 'owner' });
  }
}

export class ProjectBrowserLocks {
  #locks = new Map<string, ProjectBrowserLock>();
  #defaultTimeoutMs: number;

  constructor(defaultTimeoutMs = 120_000) {
    this.#defaultTimeoutMs = defaultTimeoutMs;
  }

  of(slug: string, timeoutMs = this.#defaultTimeoutMs): ProjectBrowserLock {
    let lock = this.#locks.get(slug);
    if (!lock) {
      lock = new ProjectBrowserLock(timeoutMs);
      this.#locks.set(slug, lock);
    } else {
      lock.setAgentTimeoutMs(timeoutMs);
    }
    return lock;
  }

  all(): Map<string, ProjectBrowserLock> {
    return this.#locks;
  }
}
