import type { HelenaApi, FollowupBatch } from './helena-client';

export interface TurnInstructions {
  readonly signal: AbortSignal;
  pending(): Promise<boolean>;
  consume(boundary: { sessionId: string; afterSeq: number; step: number }): Promise<FollowupBatch>;
}

export class FollowupInbox implements TurnInstructions {
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private reading: Promise<FollowupBatch> | null = null;
  constructor(private readonly read: NonNullable<HelenaApi['followups']>) {}
  get signal() {
    return this.controller.signal;
  }
  start() {
    const poll = async () => {
      try {
        await this.pending();
      } catch {
        /* The boundary fails closed if the API stays unavailable. */
      }
      if (!this.stopped) this.timer = setTimeout(() => void poll(), 250);
    };
    void poll();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  async pending() {
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    const result = await this.reading;
    if (result.replace) this.controller.abort();
    return result.pending;
  }
  async consume(boundary: { sessionId: string; afterSeq: number; step: number }) {
    // Settle an earlier peek before resetting the cancellation signal.
    if (this.reading) await this.reading;
    const result = await this.read(boundary);
    if (result.replace) this.controller = new AbortController();
    return result;
  }
}
