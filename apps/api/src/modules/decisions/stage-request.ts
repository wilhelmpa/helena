export class StageRevoked extends Error {}
export const FIRST_STAGE_POLL_MS = 100;

export async function withStageGuard<T>(
  enabled: () => Promise<boolean>,
  outerSignal: AbortSignal | undefined,
  ask: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (outerSignal?.aborted || !(await enabled())) throw new StageRevoked('Jev stage is disabled.');
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    controller.abort();
    rejectAbort(new StageRevoked('Jev stage was disabled.'));
  };
  outerSignal?.addEventListener('abort', abort, { once: true });
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void enabled()
      .then((allowed) => {
        if (!allowed) abort();
      })
      .catch(abort)
      .finally(() => {
        checking = false;
      });
  }, FIRST_STAGE_POLL_MS);
  try {
    if (outerSignal?.aborted) throw new StageRevoked('Jev stage was disabled.');
    const result = await Promise.race([ask(controller.signal), stopped]);
    if (!(await enabled()) || controller.signal.aborted)
      throw new StageRevoked('Jev stage was disabled.');
    return result;
  } finally {
    clearInterval(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
}
