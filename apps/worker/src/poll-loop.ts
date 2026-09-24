// The worker's poll loops run on the loop helper Helena's background jobs share
// (@helena/loop): a tick reschedules itself after it finished, so ticks never overlap.
import { startLoop, type LoopHandle } from '@helena/loop';

export type WorkerHandle = LoopHandle;

export const startPollLoop = startLoop;
