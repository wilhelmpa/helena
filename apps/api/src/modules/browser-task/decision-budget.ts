export class DecisionTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// One budget covers every question sent to the local classifier.
export class DecisionBudget {
  waitMs = 0;
  generationMs = 0;

  constructor(
    private readonly queueMs: number,
    private readonly modelMs: number,
  ) {}

  async run<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal, admitted: () => void) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let phase: 'queue' | 'generation' = 'queue';
    let started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    let rejectStop: (error: unknown) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = (reason: unknown) => {
      rejectStop(reason);
      controller.abort(reason);
    };
    const arm = () =>
      setTimeout(
        () => stop(new DecisionTimeout(`Mail classification ${phase} budget exhausted`)),
        Math.max(
          0,
          phase === 'queue' ? this.queueMs - this.waitMs : this.modelMs - this.generationMs,
        ),
      );
    const account = () => {
      const elapsed = performance.now() - started;
      if (phase === 'queue') this.waitMs += elapsed;
      else this.generationMs += elapsed;
      started = performance.now();
    };
    const admitted = () => {
      if (phase !== 'queue' || controller.signal.aborted) return;
      account();
      phase = 'generation';
      clearTimeout(timer);
      timer = arm();
    };
    const abort = () => stop(signal!.reason);
    signal?.addEventListener('abort', abort, { once: true });
    timer = arm();
    try {
      return await Promise.race([operation(controller.signal, admitted), stopped]);
    } finally {
      account();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
