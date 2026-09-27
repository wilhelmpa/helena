import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

type State = { stopping: boolean; releasing: boolean; stops: Set<AbortController> };

export function watchDescriptorReload(
  state: State,
  log: (message: string) => void,
  beforeRelease: () => boolean,
  readGeneration: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): () => void {
  const requestPath = process.env.HERMES_RUNNER_RESTART_REQUEST_PATH;
  if (!requestPath) return () => {};
  if (!isAbsolute(requestPath)) throw new Error('runner restart request path must be absolute');
  const baseline = process.env.HERMES_RUNNER_RESTART_BASELINE ?? '';
  const configured = Number(process.env.HERMES_RUNNER_RESTART_MAX_DRAIN_MS);
  const maxDrainMs =
    Number.isFinite(configured) && configured >= 1_000
      ? Math.min(configured, 24 * 60 * 60 * 1_000)
      : 2 * 60 * 60 * 1_000;
  let checking = false;
  let canceled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let exit: ReturnType<typeof setTimeout> | undefined;
  const interval = setInterval(async () => {
    if (checking || canceled || state.stopping) return;
    checking = true;
    try {
      const generation = await readGeneration(requestPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return '';
        throw err;
      });
      // SIGINT can arrive while the marker read is still pending.
      if (canceled || state.stopping || generation.trim() === baseline.trim()) return;
      clearInterval(interval);
      state.stopping = true;
      log('agent descriptors changed — finishing claimed work before reloading');
      deadline = setTimeout(() => {
        if (canceled || state.releasing || !beforeRelease()) return;
        state.releasing = true;
        log('descriptor reload drain deadline reached — releasing unfinished runs');
        for (const stop of state.stops) stop.abort();
        exit = setTimeout(() => {
          if (!canceled) process.exit(1);
        }, 10_000);
        exit.unref();
      }, maxDrainMs);
      deadline.unref();
    } catch (err) {
      log(`checking descriptor reload request failed: ${String(err)}`);
    } finally {
      checking = false;
    }
  }, 1_000);
  interval.unref();
  return () => {
    canceled = true;
    clearInterval(interval);
    clearTimeout(deadline);
    clearTimeout(exit);
  };
}
