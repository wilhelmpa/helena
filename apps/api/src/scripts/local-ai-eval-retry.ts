import { setTimeout } from 'node:timers/promises';
import { NpuDecisionReadoutError } from '../modules/local-ai/npu-eval';

export interface EvalRetry {
  error: string;
  delayMs: number;
  attempt: number;
  reason: 'socket_closed' | 'proxy_unavailable';
}

function socketClosed(error: unknown): boolean {
  if (error instanceof NpuDecisionReadoutError)
    return error.report.errors.some((item) => socketClosed(item.error));
  const message = error instanceof Error ? error.message : String(error);
  return (
    /socket(?: connection)? (?:was )?closed/i.test(message) ||
    (error instanceof Error && error.cause !== undefined && socketClosed(error.cause))
  );
}

function proxyUnavailable(error: unknown): boolean {
  if (error instanceof NpuDecisionReadoutError)
    return (
      error.report.failures.length === 0 &&
      error.report.timeouts.length === 0 &&
      error.report.errors.length > 0 &&
      error.report.errors.every((item) => proxyUnavailable(item.error))
    );
  const message = error instanceof Error ? error.message : String(error);
  if (/\bHTTP (?:502|503)\b|\bbackend_unavailable\b/i.test(message)) return true;
  if (error && typeof error === 'object') {
    const detail = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    return (
      detail.status === 502 ||
      detail.status === 503 ||
      detail.statusCode === 502 ||
      detail.statusCode === 503 ||
      detail.code === 'backend_unavailable' ||
      (detail.cause !== undefined && proxyUnavailable(detail.cause))
    );
  }
  return false;
}

export async function retryLocalAiEval<T>(
  run: () => Promise<T>,
  onRetry: (retry: EvalRetry) => void,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      let reason: EvalRetry['reason'] | null = null;
      if (proxyUnavailable(error)) reason = 'proxy_unavailable';
      else if (socketClosed(error)) reason = 'socket_closed';
      if (!reason || attempt >= (reason === 'socket_closed' ? 2 : 3)) throw error;
      const delayMs = 1_000 * 2 ** (attempt - 1);
      onRetry({
        error: error instanceof Error ? error.message : String(error),
        delayMs,
        attempt: attempt + 1,
        reason,
      });
      await setTimeout(delayMs);
    }
  }
}
