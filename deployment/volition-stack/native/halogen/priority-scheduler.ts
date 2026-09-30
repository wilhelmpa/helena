import { DEFAULT_PRIORITY_CONFIG, type PriorityConfig } from '../../../../packages/sdk/src/halogen-priority';

export type PriorityClass = 'interactive' | 'realtime' | 'normal' | 'background';
const classes: PriorityClass[] = ['interactive', 'realtime', 'normal', 'background'];
const rank: Record<PriorityClass, number> = { interactive: 3, realtime: 2, normal: 1, background: 0 };

type Admission = 'admitted' | 'busy' | 'backend_unavailable' | 'aborted';

interface Waiting {
  kind: PriorityClass;
  since: number;
  finish: (admitted: Admission) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class PriorityScheduler {
  private config: PriorityConfig;
  private active: Record<PriorityClass, number> = {
    interactive: 0, realtime: 0, normal: 0, background: 0,
  };
  private waiting: Waiting[] = [];
  private healthy = true;
  private administrativePaused = false;
  admissionCheck: (() => boolean) | undefined;

  setAdministrativePaused(paused: boolean): void {
    this.administrativePaused = paused;
    this.drain();
  }

  private paused(): boolean {
    return this.administrativePaused || (this.admissionCheck?.() ?? false);
  }
  private fallbacks: Record<PriorityClass, number> = {
    interactive: 0, realtime: 0, normal: 0, background: 0,
  };

  constructor(config: PriorityConfig = DEFAULT_PRIORITY_CONFIG, private readonly now = Date.now) {
    this.config = config;
  }

  setConfig(config: PriorityConfig): void {
    this.config = config;
    this.drain();
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
    if (!healthy) {
      for (const item of [...this.waiting]) {
        if (item.kind !== 'interactive' && item.kind !== 'realtime') continue;
        this.waiting.splice(this.waiting.indexOf(item), 1);
        if (item.timer) clearTimeout(item.timer);
        this.fallbacks[item.kind]++;
        item.finish('backend_unavailable');
      }
    }
    this.drain();
  }

  recordFallback(kind: PriorityClass): void {
    this.fallbacks[kind]++;
  }

  status() {
    const waits = Object.fromEntries(classes.map((kind) => [kind,
      this.waiting.filter((item) => item.kind === kind)])) as Record<PriorityClass, Waiting[]>;
    return {
      config: this.config,
      healthy: this.healthy,
      administrativePaused: this.paused(),
      active: { ...this.active },
      queued: Object.fromEntries(classes.map((kind) => [kind, waits[kind].length])) as Record<PriorityClass, number>,
      oldestWaitMs: Math.max(0, ...this.waiting.map((item) => this.now() - item.since)),
      oldestWaitMsByClass: Object.fromEntries(classes.map((kind) => [kind,
        Math.max(0, ...waits[kind].map((item) => this.now() - item.since))])) as Record<PriorityClass, number>,
      fallbacks: { ...this.fallbacks },
      paused: {
        interactive: !this.healthy || this.paused(),
        realtime: !this.healthy || this.paused(),
        normal: !this.healthy || this.paused(),
        background: !this.healthy || this.paused() || this.active.interactive + this.active.realtime > 0 ||
          waits.interactive.length + waits.realtime.length > 0,
      },
    };
  }

  private total(): number {
    return classes.reduce((sum, kind) => sum + this.active[kind], 0);
  }

  private eligible(kind: PriorityClass): boolean {
    if (this.paused() || !this.healthy || this.total() >= this.config.maxConcurrent) return false;
    const cap: Record<PriorityClass, number> = {
      interactive: this.config.maxInteractive,
      realtime: this.config.maxRealtime,
      normal: this.config.maxNormal,
      background: this.config.maxBackground,
    };
    if (this.active[kind] >= cap[kind]) return false;
    if (kind === 'interactive') return true;
    if (this.total() - this.active.interactive >=
      this.config.maxConcurrent - this.config.reservedInteractive) return false;
    if (kind === 'background' &&
      (this.active.interactive + this.active.realtime > 0 ||
        this.waiting.some((item) => item.kind === 'interactive' || item.kind === 'realtime'))) {
      // Aged work may use spare non-interactive capacity even under sustained demand.
      return this.waiting.some((item) => item.kind === 'background' &&
        this.now() - item.since >= this.config.agingMs * 3);
    }
    return true;
  }

  private choose(): Waiting | undefined {
    const eligible = this.waiting.filter((item) => this.eligible(item.kind));
    eligible.sort((a, b) => {
      const score = (item: Waiting) => rank[item.kind] +
        Math.floor((this.now() - item.since) / this.config.agingMs) * (4 - rank[item.kind]);
      return score(b) - score(a) || a.since - b.since || this.waiting.indexOf(a) - this.waiting.indexOf(b);
    });
    return eligible[0];
  }

  private drain(): void {
    for (;;) {
      const item = this.choose();
      if (!item) return;
      this.waiting.splice(this.waiting.indexOf(item), 1);
      if (item.timer) clearTimeout(item.timer);
      this.active[item.kind]++;
      item.finish('admitted');
    }
  }

  async acquireWithReason(kind: PriorityClass, signal?: AbortSignal): Promise<
    { release: () => void; reason?: never } | { release: null; reason: Exclude<Admission, 'admitted'> }
  > {
    if (signal?.aborted) return { release: null, reason: 'aborted' };
    if (!this.healthy && (kind === 'interactive' || kind === 'realtime')) {
      this.fallbacks[kind]++;
      return { release: null, reason: 'backend_unavailable' };
    }
    let admitted: Admission;
    if ((this.waiting.length === 0 ||
      ((kind === 'interactive' || kind === 'realtime') &&
        !this.waiting.some((item) => rank[item.kind] >= rank[kind]))) && this.eligible(kind)) {
      this.active[kind]++;
      admitted = 'admitted';
    } else if (this.waiting.length >= this.config.maxQueue ||
      this.waiting.filter((item) => item.kind === kind).length >= ({
        interactive: this.config.maxQueuedInteractive,
        realtime: this.config.maxQueuedRealtime,
        normal: this.config.maxQueuedNormal,
        background: this.config.maxQueuedBackground,
      })[kind]) {
      this.fallbacks[kind]++;
      return { release: null, reason: this.healthy ? 'busy' : 'backend_unavailable' };
    } else {
      admitted = await new Promise<Admission>((resolve) => {
        const item: Waiting = { kind, since: this.now(), finish: resolve };
        const timeout = kind === 'realtime' ? this.config.realtimeQueueMs :
          kind === 'interactive' ? this.config.interactiveQueueMs :
          kind === 'normal' ? this.config.queueTimeoutMs : null;
        const finish = (value: Admission) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        };
        const abort = () => {
          const index = this.waiting.indexOf(item);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            if (item.timer) clearTimeout(item.timer);
            finish('aborted');
            this.drain();
          }
        };
        item.finish = finish;
        if (timeout !== null) item.timer = setTimeout(() => {
          const index = this.waiting.indexOf(item);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          this.fallbacks[kind]++;
          finish(this.healthy ? 'busy' : 'backend_unavailable');
          this.drain();
        }, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        this.waiting.push(item);
        this.drain();
      });
    }
    if (admitted !== 'admitted') return { release: null, reason: admitted };
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;
      this.active[kind]--;
      this.drain();
    } };
  }

  async acquire(kind: PriorityClass, signal?: AbortSignal): Promise<(() => void) | null> {
    return (await this.acquireWithReason(kind, signal)).release;
  }
}
