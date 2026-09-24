import type { JanitorHealth, SystemHealth } from '@/lib/api/endpoints/god';

export type HealthProblem =
  | { key: 'waiting'; count: number; since: string | null }
  | {
      key:
        | 'overdue'
        | 'resuming'
        | 'needsResumeReview'
        | 'stalledWorkflowRuns'
        | 'overdueSchedules'
        | 'failedLastDay'
        | 'failedWorkflowRuns'
        | 'provisioningFailed';
      count: number;
    };

// What of the agent runs and the engine's runs needs the owner's attention, most
// urgent first. A count of zero is left out. `resuming` is not itself a problem -- a run
// picking its session back up is the point of resuming -- but it is worth naming so the
// owner sees resilience working rather than wondering why a run they know crashed is
// still going.
export function healthProblems(
  runs: SystemHealth['runs'],
  engine?: Pick<SystemHealth['engine'], 'stalled' | 'overdueSchedules' | 'failedLastDay'>,
): HealthProblem[] {
  const problems: HealthProblem[] = [];
  if (runs.waiting > 0)
    problems.push({ key: 'waiting', count: runs.waiting, since: runs.oldestWaitingSince });
  const counts = {
    overdue: runs.overdue,
    resuming: runs.resuming,
    needsResumeReview: runs.needsResumeReview,
    stalledWorkflowRuns: engine?.stalled ?? 0,
    overdueSchedules: engine?.overdueSchedules ?? 0,
    failedLastDay: runs.failedLastDay,
    failedWorkflowRuns: engine?.failedLastDay ?? 0,
    provisioningFailed: runs.provisioningFailed,
  };
  for (const [key, count] of Object.entries(counts) as [keyof typeof counts, number][])
    if (count > 0) problems.push({ key, count });
  return problems;
}

export interface JanitorSummary {
  ranAt: string;
  // What it cleaned up that run, when it found anything: a run that cleaned nothing
  // is not worth a number next to the time.
  cleaned: number | null;
}

// What a janitor card says under its name: null while it has never run yet.
export function janitorSummary(
  health: Pick<JanitorHealth, 'ranAt' | 'cleaned'>,
): JanitorSummary | null {
  if (!health.ranAt) return null;
  return {
    ranAt: health.ranAt,
    cleaned: health.cleaned && health.cleaned > 0 ? health.cleaned : null,
  };
}

// A service's or janitor's state in the app's one status vocabulary (StatusBadge): ok
// is success, down is danger, and a state nobody could ask for yet is idle.
export function healthStatus(state: 'ok' | 'down' | 'unknown'): 'success' | 'danger' | 'idle' {
  if (state === 'ok') return 'success';
  if (state === 'down') return 'danger';
  return 'idle';
}
