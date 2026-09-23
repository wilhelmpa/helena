import {
  agentRun,
  agentTeamStart,
  aiAgent,
  db,
  projectDeprovisioningJob,
  projectProvisioningJob,
  projectSetting,
  recordServiceCheck,
  serviceHeartbeat,
} from '@repo/db';
import { and, eq, gt, like, sql } from 'drizzle-orm';
import { iso } from '#shared/lib';
import {
  controlPlaneHealthUrl,
  controlPlaneRequest,
} from '#modules/control-plane-workflows/service';

// The state of the services Plan works with, for the owner's overview on Home. The
// worker and the bridge report themselves, the worker checks the provisioning service,
// a runner is seen when it polls, and Mastra is checked when the overview is read.

export const SERVICES = ['runner', 'mastra', 'bridge', 'provisioning', 'worker'] as const;
type Service = (typeof SERVICES)[number];

// How long a service may go unseen before it counts as down. The worker and the bridge
// report every 30 seconds, the provisioning service is checked with the worker's report,
// a runner polls every few seconds, and Mastra was checked just now.
const SILENCE_MS: Record<Service, number> = {
  runner: 120_000,
  mastra: 60_000,
  bridge: 120_000,
  provisioning: 180_000,
  worker: 120_000,
};

// A claimed run that is still leased this long after the limit the runner applies to it
// has overrun it: the run's budget, and the runner's own 30-minute stop at least.
const OVERDUE_GRACE_SECONDS = 600;
const RUNNER_STOP_SECONDS = 1_800;

// An agent-team run Mastra has not moved on for this long, with no stage run of it
// waiting in Plan, makes no progress.
const STALL_MS = 15 * 60_000;

export interface ServiceHealth {
  service: Service;
  state: 'ok' | 'down' | 'unknown';
  lastSeenAt: string | null;
  error: string | null;
}

function health(
  service: Service,
  row: { lastSeenAt: Date | null; error: string | null } | undefined,
): ServiceHealth {
  if (!row || (!row.lastSeenAt && !row.error))
    return { service, state: 'unknown', lastSeenAt: null, error: null };
  const recent =
    row.lastSeenAt !== null && Date.now() - row.lastSeenAt.getTime() <= SILENCE_MS[service];
  return {
    service,
    state: recent && !row.error ? 'ok' : 'down',
    lastSeenAt: row.lastSeenAt ? iso(row.lastSeenAt) : null,
    error: row.error,
  };
}

async function checkMastra(): Promise<void> {
  let error: string | null;
  try {
    const response = await fetch(controlPlaneHealthUrl(), { signal: AbortSignal.timeout(3_000) });
    error = response.ok ? null : `HTTP ${response.status}`;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  await recordServiceCheck('mastra', error);
}

async function runCounts() {
  const [runs] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${agentRun.nextAttemptAt} <= now())::int`,
      oldestWaitingSince:
        sql<Date | null>`min(${agentRun.createdAt}) filter (where ${agentRun.nextAttemptAt} <= now())`.mapWith(
          agentRun.createdAt,
        ),
      overdue: sql<number>`count(*) filter (where ${agentRun.attempts} > 0
        and ${agentRun.nextAttemptAt} > now()
        and ${agentRun.startedAt} < now() - make_interval(secs =>
          greatest(coalesce(${agentRun.runBudgetSeconds}, 0), ${RUNNER_STOP_SECONDS}) + ${OVERDUE_GRACE_SECONDS}))::int`,
    })
    .from(agentRun)
    .where(eq(agentRun.status, 'pending'));
  const [failed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRun)
    .where(
      and(eq(agentRun.status, 'failed'), gt(agentRun.finishedAt, sql`now() - interval '1 day'`)),
    );
  const [starts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTeamStart)
    .where(eq(agentTeamStart.status, 'pending'));
  const [provisioning] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectProvisioningJob)
    .where(eq(projectProvisioningJob.status, 'failed'));
  const [deprovisioning] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectDeprovisioningJob)
    .where(eq(projectDeprovisioningJob.status, 'failed'));
  return {
    waiting: runs?.waiting ?? 0,
    oldestWaitingSince: runs?.oldestWaitingSince ? iso(runs.oldestWaitingSince) : null,
    overdue: runs?.overdue ?? 0,
    failedLastDay: failed?.count ?? 0,
    agentTeamStartsWaiting: starts?.count ?? 0,
    provisioningFailed: (provisioning?.count ?? 0) + (deprovisioning?.count ?? 0),
  };
}

// The active agent-team runs Mastra has not moved on for a while and that wait on no
// stage run in Plan. Null while Mastra cannot be asked.
async function stalledWorkflowRuns(): Promise<number | null> {
  const active = await controlPlaneRequest<{ runs?: { runId?: unknown; updatedAt?: unknown }[] }>(
    { operation: 'active-runs', workflowId: 'agent-team' },
    5_000,
  ).catch(() => null);
  if (!active) return null;
  const waitingOnPlan = await db
    .select({ workflowRunId: sql<string | null>`${projectSetting.value}->>'workflowRunId'` })
    .from(projectSetting)
    .innerJoin(agentRun, sql`${agentRun.id} = (${projectSetting.value}->>'runId')::int`)
    .where(and(like(projectSetting.key, 'mastra-agent-run:%'), eq(agentRun.status, 'pending')));
  const waiting = new Set(waitingOnPlan.map((row) => row.workflowRunId));
  const before = Date.now() - STALL_MS;
  return (active.runs ?? []).filter(
    (run) =>
      typeof run.runId === 'string' &&
      !waiting.has(run.runId) &&
      Date.parse(String(run.updatedAt)) < before,
  ).length;
}

export async function systemHealth() {
  await checkMastra();
  const [reported, [runner], runs, stalled] = await Promise.all([
    db.select().from(serviceHeartbeat),
    db
      .select({ lastSeenAt: sql`max(${aiAgent.lastSeenAt})`.mapWith(aiAgent.lastSeenAt) })
      .from(aiAgent)
      .where(eq(aiAgent.kind, 'external')),
    runCounts(),
    stalledWorkflowRuns(),
  ]);
  const byService = new Map(reported.map((row) => [row.service, row]));
  return {
    services: SERVICES.map((service) =>
      health(
        service,
        service === 'runner'
          ? { lastSeenAt: runner?.lastSeenAt ?? null, error: null }
          : byService.get(service),
      ),
    ),
    runs: { ...runs, stalledWorkflowRuns: stalled },
  };
}
