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

export function modelReadyAndIdle(health: unknown, model: string): boolean {
  if (!health || typeof health !== 'object') return false;
  const entries = (health as { all_models_loaded?: unknown }).all_models_loaded;
  if (!Array.isArray(entries)) return false;
  let loaded = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (item.model_name === model || item.id === model) loaded = true;
    if (item.is_busy === true || item.is_streaming === true || item.status === 'loading')
      return false;
  }
  return loaded;
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
