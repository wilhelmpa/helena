import { APICallError } from 'ai';
import type { EventSink } from './events';

export class LocalModelBusy extends Error {
  constructor() {
    super('Das lokale Modell ist ausgelastet.');
  }
}

function localRetryError(
  error: unknown,
): { error: APICallError; backendUnavailable: boolean } | null {
  if (!APICallError.isInstance(error)) return null;
  try {
    const body = error.data ?? JSON.parse(error.responseBody ?? '{}');
    if (error.statusCode === 503 && body?.error?.code === 'engine_busy')
      return { error, backendUnavailable: false };
    if (
      (error.statusCode === 502 || error.statusCode === 503) &&
      body?.error?.code === 'backend_unavailable'
    )
      return { error, backendUnavailable: true };
    return null;
  } catch {
    return null;
  }
}

function retryAfterMs(error: APICallError): number {
  const value = error.responseHeaders?.['retry-after'];
  if (!value) return 0;
  const seconds = Number(value);
  return (
    Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()) || 0
  );
}

export interface QueueAttempt {
  remainingMs: number;
  admitted: (waitMs: number) => void;
}

export class LocalQueueRetry {
  constructor(
    private remainingMs: number,
    private readonly sink: EventSink,
  ) {}

  async run<T>(
    model: string,
    signal: AbortSignal,
    operation: (queue: QueueAttempt) => Promise<T>,
    fallback = false,
  ): Promise<T> {
    let attempt = 0;
    let backendAttempts = 0;
    for (;;) {
      signal.throwIfAborted();
      if (this.remainingMs <= 0 && !fallback) throw new LocalModelBusy();
      const started = Date.now();
      let admitted = false;
      try {
        return await operation({
          remainingMs: this.remainingMs,
          admitted: (waitMs) => {
            admitted = true;
            this.remainingMs = Math.max(0, this.remainingMs - waitMs);
          },
        });
      } catch (error) {
        signal.throwIfAborted();
        const retry = localRetryError(error);
        if (!retry) throw error;
        if (!admitted) this.remainingMs -= Date.now() - started;
        if (retry.backendUnavailable && (admitted || backendAttempts >= 2 || this.remainingMs <= 0))
          throw error;
        if (this.remainingMs <= 0) throw new LocalModelBusy();
        const retryAttempt = retry.backendUnavailable ? backendAttempts++ : attempt++;
        const delayMs = Math.min(
          this.remainingMs,
          Math.max(
            Math.min(1000 * 2 ** Math.min(retryAttempt, 5), 30_000),
            retryAfterMs(retry.error),
          ),
        );
        this.sink.emit({
          type: 'status',
          status: 'model-queued',
          model,
          message: retry.backendUnavailable
            ? 'Wartet auf lokales Modell'
            : 'Wartet auf freien Modellplatz',
          retryAfterMs: delayMs,
          remainingMs: Math.max(0, this.remainingMs),
        });
        const waiting = Date.now();
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            signal.removeEventListener('abort', abort);
            resolve();
          };
          const timer = setTimeout(finish, delayMs);
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
        this.remainingMs -= Date.now() - waiting;
        if (this.remainingMs <= 0) {
          if (retry.backendUnavailable) throw error;
          throw new LocalModelBusy();
        }
      }
    }
  }
}
