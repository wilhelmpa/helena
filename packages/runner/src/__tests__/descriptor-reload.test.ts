import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { watchDescriptorReload } from '../descriptor-reload';

type Tick = { delay: number; cleared: boolean; fire: () => void | Promise<void> };
const keys = [
  'HERMES_RUNNER_RESTART_REQUEST_PATH',
  'HERMES_RUNNER_RESTART_BASELINE',
  'HERMES_RUNNER_RESTART_MAX_DRAIN_MS',
] as const;
let previous: (string | undefined)[];
const restore: (() => void)[] = [];
const intervals: Tick[] = [];
const timeouts: Tick[] = [];
const handles = new Map<unknown, Tick>();

beforeEach(() => {
  previous = keys.map((key) => process.env[key]);
  process.env.HERMES_RUNNER_RESTART_REQUEST_PATH = '/synthetic/restart-generation';
  process.env.HERMES_RUNNER_RESTART_BASELINE = 'old';
  process.env.HERMES_RUNNER_RESTART_MAX_DRAIN_MS = '1000';
  const register =
    (collection: Tick[]) => (callback: () => void | Promise<void>, delay?: number) => {
      const tick = { delay: delay ?? 0, cleared: false, fire: callback };
      const handle = { unref: () => handle } as unknown as ReturnType<typeof setTimeout>;
      collection.push(tick);
      handles.set(handle, tick);
      return handle;
    };
  const clear = (handle: unknown) => {
    const tick = handles.get(handle);
    if (tick) tick.cleared = true;
  };
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(
    register(intervals) as typeof setInterval,
  );
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(
    register(timeouts) as typeof setTimeout,
  );
  const clearIntervalSpy = spyOn(globalThis, 'clearInterval').mockImplementation(clear);
  const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').mockImplementation(clear);
  restore.push(
    () => interval.mockRestore(),
    () => timeout.mockRestore(),
    () => clearIntervalSpy.mockRestore(),
    () => clearTimeoutSpy.mockRestore(),
  );
});

afterEach(() => {
  for (const step of restore.splice(0).reverse()) step();
  keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  });
  intervals.length = 0;
  timeouts.length = 0;
  handles.clear();
});

function fixture(
  beforeRelease: () => boolean = () => true,
  read: () => Promise<string> = async () => 'new',
) {
  const controller = new AbortController();
  const state = { stopping: false, releasing: false, stops: new Set([controller]) };
  const cancel = watchDescriptorReload(state, () => {}, beforeRelease, read);
  return { state, controller, cancel };
}

it('a marker read completing after explicit drain cannot arm another deadline', async () => {
  const generation = Promise.withResolvers<string>();
  const f = fixture(
    () => true,
    () => generation.promise,
  );
  const checking = intervals[0]!.fire();
  f.cancel();
  f.state.stopping = true;
  generation.resolve('new');
  await checking;
  expect(intervals[0]!.cleared).toBe(true);
  expect(timeouts).toHaveLength(0);
  expect(f.state.releasing).toBe(false);
  expect(f.controller.signal.aborted).toBe(false);
});

it('explicit drain clears an armed deadline and rejects its already queued callback', async () => {
  let releases = 0;
  const f = fixture(() => {
    releases++;
    return true;
  });
  await intervals[0]!.fire();
  expect(f.state.stopping).toBe(true);
  expect(timeouts[0]!.delay).toBe(1000);
  f.cancel();
  expect(timeouts[0]!.cleared).toBe(true);
  await timeouts[0]!.fire();
  expect(releases).toBe(0);
  expect(f.state.releasing).toBe(false);
  expect(f.controller.signal.aborted).toBe(false);
  expect(timeouts).toHaveLength(1);
});

it('cancel after release began clears the ten-second forced exit without reversing release', async () => {
  const ordering: string[] = [];
  const f = fixture(() => {
    ordering.push('record-releasing');
    return true;
  });
  f.controller.signal.addEventListener('abort', () => ordering.push('abort'));
  const exit = spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('unexpected exit');
  });
  restore.push(() => exit.mockRestore());
  await intervals[0]!.fire();
  await timeouts[0]!.fire();
  expect(ordering).toEqual(['record-releasing', 'abort']);
  expect(timeouts[1]!.delay).toBe(10_000);
  f.cancel();
  expect(timeouts[1]!.cleared).toBe(true);
  await timeouts[1]!.fire();
  expect(exit).not.toHaveBeenCalled();
  expect(f.state.releasing).toBe(true);
  expect(f.controller.signal.aborted).toBe(true);
});

it('does not abort work when the unsafe capability phase could not be recorded', async () => {
  const f = fixture(() => false);
  await intervals[0]!.fire();
  await timeouts[0]!.fire();
  expect(f.state.stopping).toBe(true);
  expect(f.state.releasing).toBe(false);
  expect(f.controller.signal.aborted).toBe(false);
  expect(timeouts).toHaveLength(1);
});

it('keeps the bounded descriptor release and forced exit when no deploy drain occurred', async () => {
  const f = fixture();
  const exit = spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('synthetic exit');
  });
  restore.push(() => exit.mockRestore());
  await intervals[0]!.fire();
  await timeouts[0]!.fire();
  expect(f.state.releasing).toBe(true);
  expect(f.controller.signal.aborted).toBe(true);
  expect(() => timeouts[1]!.fire()).toThrow('synthetic exit');
  expect(exit).toHaveBeenCalledWith(1);
});
