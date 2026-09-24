// The one poll loop of Helena's background jobs (the api's queues and janitors, the
// worker's deliveries) and the env reader they are tuned with. A loop reschedules itself
// after each tick (a recursive setTimeout, not setInterval), so ticks never overlap when
// one runs long, and reads its interval per tick. A tick that throws is logged and the
// loop goes on.

export interface LoopHandle {
  stop: () => void;
}

export function startLoop(
  name: string,
  tick: () => Promise<unknown>,
  intervalMs: () => number,
  options: { unref?: boolean } = {},
): LoopHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      await tick();
    } catch (error) {
      console.error(`[${name}] tick failed:`, error);
    }
    if (stopped) return;
    timer = setTimeout(loop, intervalMs());
    if (options.unref) timer.unref?.();
  }

  void loop();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// A positive integer from the environment, or `fallback` when the variable is unset,
// empty, not a number, or not greater than zero.
export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
