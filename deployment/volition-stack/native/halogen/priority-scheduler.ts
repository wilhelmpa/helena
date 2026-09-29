import { DEFAULT_PRIORITY_CONFIG, type PriorityConfig } from '../../../../packages/sdk/src/halogen-priority';

export type PriorityClass = 'interactive' | 'normal' | 'background';

interface Waiting {
  kind: PriorityClass;
  since: number;
  finish: (admitted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PriorityScheduler {
  private config: PriorityConfig;
  private active: Record<PriorityClass, number> = {
    interactive: 0,
    normal: 0,
    background: 0,
  };
  private waiting: Waiting[] = [];
  private interactiveBurst = 0;

  constructor(config: PriorityConfig = DEFAULT_PRIORITY_CONFIG, private readonly now = Date.now) {
    this.config = config;
  }

  setConfig(config: PriorityConfig): void {
    this.config = config;
    this.drain();
  }

  status() {
    return {
      config: this.config,
      active: { ...this.active },
      queued: {
        interactive: this.waiting.filter((item) => item.kind === 'interactive').length,
        normal: this.waiting.filter((item) => item.kind === 'normal').length,
        background: this.waiting.filter((item) => item.kind === 'background').length,
      },
      oldestWaitMs: this.waiting.length ? this.now() - this.waiting[0]!.since : 0,
    };
  }

  private total(): number {
    return this.active.interactive + this.active.normal + this.active.background;
  }

  private eligible(kind: PriorityClass): boolean {
    if (this.total() >= this.config.maxConcurrent) return false;
    if (kind === 'interactive') return true;
    if (this.active.normal + this.active.background >=
      this.config.maxConcurrent - this.config.reservedInteractive) return false;
    return kind !== 'background' || this.active.background < this.config.maxBackground;
  }

  private choose(): Waiting | undefined {
    const eligible = this.waiting.filter((item) => this.eligible(item.kind));
    const chat = eligible.find((item) => item.kind === 'interactive');
    const aged = eligible.find((item) => item.kind !== 'interactive' &&
      this.now() - item.since >= Math.min(
        item.kind === 'normal' ? 10_000 : 20_000,
        this.config.queueTimeoutMs * (item.kind === 'normal' ? 0.5 : 0.75),
      ));
    if (chat && (this.interactiveBurst < 4 || !aged)) return chat;
    if (aged) return aged;
    return eligible.find((item) => item.kind === 'normal') ??
      eligible.find((item) => item.kind === 'background');
  }

  private drain(): void {
    for (;;) {
      const item = this.choose();
      if (!item) return;
      this.waiting.splice(this.waiting.indexOf(item), 1);
      clearTimeout(item.timer);
      this.active[item.kind]++;
      this.interactiveBurst = item.kind === 'interactive' ? this.interactiveBurst + 1 : 0;
      item.finish(true);
    }
  }

  async acquire(kind: PriorityClass, signal?: AbortSignal): Promise<(() => void) | null> {
    if (signal?.aborted) return null;
    let admitted: boolean;
    if ((this.waiting.length === 0 ||
      (kind === 'interactive' && !this.waiting.some((item) => item.kind === 'interactive'))) &&
      this.eligible(kind)) {
      this.active[kind]++;
      admitted = true;
    } else if (this.waiting.length >= this.config.maxQueue) {
      return null;
    } else {
      admitted = await new Promise<boolean>((resolve) => {
        const finish = (value: boolean) => resolve(value);
        const item: Waiting = {
          kind,
          since: this.now(),
          finish,
          timer: setTimeout(() => {
            this.waiting.splice(this.waiting.indexOf(item), 1);
            finish(false);
            this.drain();
          }, this.config.queueTimeoutMs),
        };
        const abort = () => {
          const index = this.waiting.indexOf(item);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            clearTimeout(item.timer);
            finish(false);
            this.drain();
          }
        };
        signal?.addEventListener('abort', abort, { once: true });
        const originalFinish = item.finish;
        item.finish = (value) => {
          signal?.removeEventListener('abort', abort);
          originalFinish(value);
        };
        this.waiting.push(item);
        this.drain();
      });
    }
    if (!admitted) return null;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active[kind]--;
      this.drain();
    };
  }
}
