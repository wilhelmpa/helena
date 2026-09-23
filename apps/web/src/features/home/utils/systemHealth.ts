import type { JanitorHealth, SystemHealth } from '@/lib/api/endpoints/god';

export type HealthProblem =
  | { key: 'waiting'; count: number; since: string | null }
  | {
      key:
        | 'overdue'
        | 'agentTeamStartsWaiting'
        | 'stalledWorkflowRuns'
        | 'failedLastDay'
        | 'provisioningFailed';
      count: number;
    };

// What of the agent runs needs the owner's attention, most urgent first. A count of
// zero, and one Mastra could not be asked for, is left out.
export function healthProblems(runs: SystemHealth['runs']): HealthProblem[] {
  const problems: HealthProblem[] = [];
  if (runs.waiting > 0)
    problems.push({ key: 'waiting', count: runs.waiting, since: runs.oldestWaitingSince });
  for (const key of [
    'overdue',
    'agentTeamStartsWaiting',
    'stalledWorkflowRuns',
    'failedLastDay',
    'provisioningFailed',
  ] as const) {
    const count = runs[key] ?? 0;
    if (count > 0) problems.push({ key, count });
  }
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
