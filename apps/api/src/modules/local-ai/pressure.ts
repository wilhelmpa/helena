import { readLocalAiPolicy } from '@repo/db';

type Counts = Record<'interactive' | 'realtime' | 'normal' | 'background', number>;
export interface PressureStatus {
  healthy: boolean;
  active: Counts;
  queued: Counts;
  config: {
    maxConcurrent: number;
    reservedInteractive: number;
    maxBackground: number;
    maxNormal: number;
  };
}

export function capacityFromStatus(kind: 'normal' | 'background', status: PressureStatus): boolean {
  if (!status.healthy) return false;
  const { active, queued, config } = status;
  const total = Object.values(active).reduce((sum, count) => sum + count, 0);
  const others = total - active.interactive;
  if (kind === 'normal')
    return (
      queued.interactive + queued.realtime === 0 &&
      active.normal < config.maxNormal &&
      others < config.maxConcurrent - config.reservedInteractive
    );
  return (
    active.interactive + active.realtime + queued.interactive + queued.realtime === 0 &&
    active.background < config.maxBackground &&
    others < config.maxConcurrent - config.reservedInteractive
  );
}

// Read only, before a schedule is fired or a run is claimed. The durable schedule/run row
// stays pending; the next poll retries it under its existing id/claim fence.
export async function localAiHasCapacity(
  kind: 'normal' | 'background',
  request: typeof fetch = fetch,
): Promise<boolean> {
  const policy = await readLocalAiPolicy();
  if (!policy.enabled || !Object.values(policy.classes).some((entry) => entry.mode !== 'off'))
    return true;
  let status: PressureStatus;
  try {
    const response = await request('http://127.0.0.1:8741/priority/status', {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return kind === 'normal';
    status = (await response.json()) as PressureStatus;
  } catch {
    // Normal work can take the policy's cloud route while background work waits.
    return kind === 'normal';
  }
  return capacityFromStatus(kind, status);
}
