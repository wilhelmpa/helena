import type { SystemHealth } from '@/lib/api/endpoints/god';

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
