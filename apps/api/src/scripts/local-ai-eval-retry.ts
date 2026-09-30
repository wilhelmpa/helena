import { setTimeout } from 'node:timers/promises';
import { NpuDecisionReadoutError } from '../modules/local-ai/npu-eval';

export interface SocketRetry {
  error: string;
  delayMs: number;
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

export async function retrySocketClosed<T>(
  run: () => Promise<T>,
  onRetry: (retry: SocketRetry) => void,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!socketClosed(error)) throw error;
    const delayMs = 1_000;
    onRetry({ error: error instanceof Error ? error.message : String(error), delayMs });
    await setTimeout(delayMs);
    return run();
  }
}
