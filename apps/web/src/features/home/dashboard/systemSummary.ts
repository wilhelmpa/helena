import type { Status } from '@/components/common/page/StatusBadge';
import type { SystemHealth } from '@/lib/api/endpoints/god';
import { healthProblems, type HealthProblem } from '../utils/systemHealth';
import { loginRows, staleSince } from '../utils/runtimeLogins';

// Start's System card in one read of the health overview: one status for everything
// (the services, the maintenance loops, the model logins, the agents' profiles, the runs
// and the engine), the counts for its one summary line, and each problem the owner
// should look at, the worst first. The full overview stays one click away.

export type SystemProblem =
  | { key: 'serviceDown'; tone: 'danger'; service: string }
  | { key: 'janitorDown'; tone: 'waiting'; job: string }
  | { key: 'loginNeedsOwner'; tone: 'danger'; provider: string }
  | { key: 'loginsStale'; tone: 'waiting'; since: string }
  | { key: 'agentsDrift'; tone: 'waiting'; count: number }
  | { key: 'modelsRefused'; tone: 'waiting'; count: number }
  | { key: 'run'; tone: 'waiting'; problem: HealthProblem };

export interface SystemSummary {
  status: Status;
  services: { ok: number; total: number };
  agents: { synced: number; total: number };
  logins: { ok: number; total: number };
  janitors: { ok: number; total: number };
  problems: SystemProblem[];
}

// `resuming` is resilience working, not a problem the owner has to act on; failed runs
// are rows of "Braucht dich" already, one by one.
const QUIET_RUN_PROBLEMS = new Set<HealthProblem['key']>([
  'resuming',
  'failedLastDay',
  'failedWorkflowRuns',
]);

export function systemSummary(health: SystemHealth): SystemSummary {
  const problems: SystemProblem[] = [];
  for (const service of health.services)
    if (service.state === 'down')
      problems.push({ key: 'serviceDown', tone: 'danger', service: service.service });
  const rows = loginRows(health.logins);
  for (const row of rows)
    if (row.needsOwner)
      problems.push({ key: 'loginNeedsOwner', tone: 'danger', provider: row.login.provider });
  const stale = staleSince(health.logins);
  if (stale) problems.push({ key: 'loginsStale', tone: 'waiting', since: stale });
  for (const janitor of health.janitors)
    if (janitor.state === 'down')
      problems.push({ key: 'janitorDown', tone: 'waiting', job: janitor.job });
  const drift = health.agents ? health.agents.total - health.agents.synced : 0;
  if (drift > 0) problems.push({ key: 'agentsDrift', tone: 'waiting', count: drift });
  const refused = [
    ...(health.models?.unavailable ?? []),
    ...(health.models?.deadLogins ?? []),
  ].filter((entry) => entry.agents.length > 0).length;
  if (refused > 0) problems.push({ key: 'modelsRefused', tone: 'waiting', count: refused });
  for (const problem of healthProblems(health.runs, health.engine))
    if (!QUIET_RUN_PROBLEMS.has(problem.key))
      problems.push({ key: 'run', tone: 'waiting', problem });

  const status: Status = problems.some((problem) => problem.tone === 'danger')
    ? 'danger'
    : problems.length > 0
      ? 'waiting'
      : 'success';
  return {
    status,
    // A service nobody could ask yet (not installed here) is not counted either way.
    services: {
      ok: health.services.filter((service) => service.state === 'ok').length,
      total: health.services.filter((service) => service.state !== 'unknown').length,
    },
    agents: { synced: health.agents?.synced ?? 0, total: health.agents?.total ?? 0 },
    logins: { ok: rows.filter((row) => row.status === 'success').length, total: rows.length },
    janitors: {
      ok: health.janitors.filter((janitor) => janitor.state === 'ok').length,
      total: health.janitors.length,
    },
    problems,
  };
}
