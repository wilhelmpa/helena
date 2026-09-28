import type { HostSystemStatus } from '#modules/server/types';

export interface LocalAiGuard {
  checkedAt: string | null;
  probeAt: string | null;
  probeMs: number | null;
  probeFailures: number;
  problem: 'eviction' | 'probe' | null;
  availableBytes: number | null;
  consumers: NonNullable<HostSystemStatus['memoryConsumers']>;
}

export function probeDue(lastProbe: number, now: number): boolean {
  return now - lastProbe >= 300_000;
}

export function evictionDetected(processes: HostSystemStatus['gpuProcesses']): boolean {
  return (processes ?? []).some((entry) => (entry.evictedMs5m ?? 0) > 30_000);
}

export function probeOutcome(
  current: LocalAiGuard,
  at: number,
  duration: number,
  ok: boolean,
  eviction: boolean,
): LocalAiGuard {
  const failures = ok ? 0 : current.probeFailures + 1;
  return {
    ...current,
    probeAt: new Date(at).toISOString(),
    probeMs: duration,
    probeFailures: failures,
    problem: eviction ? 'eviction' : failures >= 3 ? 'probe' : null,
  };
}
