import {
  agentRun,
  aiAgent,
  db,
  helenaSchedule,
  listJanitorRuns,
  pipeline,
  pipelineRun,
  pipelineRunStep,
  project,
  projectDeprovisioningJob,
  projectProvisioningJob,
  serviceHeartbeat,
} from '@repo/db';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { iso } from '#shared/lib';
import { RESUME_LIMIT_ERROR } from '#modules/agents/runner/service';
import { runtimeSyncSummary } from '#modules/agents/runtime-sync/service';
import { engineExecutorId, engineRunning } from '#modules/engine/dbos';
import { nextFireTime } from '#modules/engine/schedules';
import { modelAvailabilityHealth } from '#modules/model-availability/service';
import { unresolvedAgentFailure, unresolvedPipelineFailure } from '#modules/pipelines/unresolved';
import { runFailures } from '#modules/pipelines/runs';
import { runtimeLogins } from '#modules/runtime-logins/service';
import { vaultIntegrity } from './vault-integrity';

// The state of the services Helena works with, for the owner's overview on Home. The
// worker and the engine report themselves, the worker checks the provisioning service,
// and a runner is seen when it polls.

export const SERVICES = ['runner', 'engine', 'provisioning', 'worker'] as const;
type Service = (typeof SERVICES)[number];

// The api's janitor loops, named the same way in background.ts, which starts them,
// and in the janitor_run table, which this file reads their last run from.
export const JANITOR_JOBS = [
  'run-janitor',
  'resume-janitor',
  'engine-maintenance',
  'runtime-janitor',
] as const;

// How long a service may go unseen before it counts as down. The worker reports every
// 30 seconds, the engine every few seconds, the provisioning service is checked with the
// worker's report, and a runner polls every few seconds.
const SILENCE_MS: Record<Service, number> = {
  runner: 120_000,
  engine: 60_000,
  provisioning: 180_000,
  worker: 120_000,
};

// A claimed run that is still leased this long after the limit the runner applies to it
// has overrun it: the run's budget, and the runner's own 30-minute stop at least.
const OVERDUE_GRACE_SECONDS = 600;
const RUNNER_STOP_SECONDS = 1_800;

// An active run the engine has not moved on for this long, while no agent run it waits
// for is pending, makes no progress.
const STALL_MS = 30 * 60_000;

// A schedule that should have fired this long ago and did not is overdue.
const SCHEDULE_OVERDUE_MS = 5 * 60_000;

// How long a janitor may go without running before it counts as stopped, rather than
// merely between runs: three times its own interval, so one slow tick is not a false
// alarm. Kept in step with the intervals background.ts starts each loop with.
const JANITOR_INTERVAL_MS: Record<(typeof JANITOR_JOBS)[number], number> = {
  'run-janitor': 60_000,
  'resume-janitor': 60_000,
  'engine-maintenance': 300_000,
  'runtime-janitor': 300_000,
};
const JANITOR_STALE_FACTOR = 3;

export interface ServiceHealth {
  service: Service;
  state: 'ok' | 'down' | 'unknown';
  lastSeenAt: string | null;
  error: string | null;
}

export interface JanitorHealth {
  job: (typeof JANITOR_JOBS)[number];
  state: 'ok' | 'down' | 'unknown';
  ranAt: string | null;
  cleaned: number | null;
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

function janitorHealth(
  job: (typeof JANITOR_JOBS)[number],
  row: { ranAt: Date; cleaned: number | null; error: string | null } | undefined,
): JanitorHealth {
  if (!row) return { job, state: 'unknown', ranAt: null, cleaned: null, error: null };
  const recent =
    Date.now() - row.ranAt.getTime() <= JANITOR_INTERVAL_MS[job] * JANITOR_STALE_FACTOR;
  return {
    job,
    state: recent && !row.error ? 'ok' : 'down',
    ranAt: iso(row.ranAt),
    cleaned: row.cleaned,
    error: row.error,
  };
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
        and ${agentRun.claimedAt} < now() - make_interval(secs =>
          greatest(coalesce(${agentRun.runBudgetSeconds}, 0), ${RUNNER_STOP_SECONDS}) + ${OVERDUE_GRACE_SECONDS}))::int`,
      // Waiting on the runner that held it to resume its session, or already resumed
      // once and running again: either way, this run survived a crash instead of
      // silently failing.
      resuming: sql<number>`count(*) filter (where ${agentRun.sessionId} is not null)::int`,
    })
    .from(agentRun)
    .where(eq(agentRun.status, 'pending'));
  const [failed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRun)
    .where(and(unresolvedAgentFailure, gt(agentRun.finishedAt, sql`now() - interval '1 day'`)));
  const [needsReview] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRun)
    .where(and(unresolvedAgentFailure, eq(agentRun.lastError, RESUME_LIMIT_ERROR)));
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
    resuming: runs?.resuming ?? 0,
    failedLastDay: failed?.count ?? 0,
    needsResumeReview: needsReview?.count ?? 0,
    provisioningFailed: (provisioning?.count ?? 0) + (deprovisioning?.count ?? 0),
  };
}

// What the engine is doing: its runs by state, the ones that stall, and the newest
// failures.
async function engineHealth() {
  const [counts] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${pipelineRun.status} = 'pending')::int`,
      active: sql<number>`count(*) filter (where ${pipelineRun.status} = 'running')::int`,
      waiting: sql<number>`count(*) filter (where ${pipelineRun.status} = 'waiting')::int`,
      failedLastDay: sql<number>`count(*) filter (where ${unresolvedPipelineFailure} and ${pipelineRun.finishedAt} > now() - interval '1 day')::int`,
    })
    .from(pipelineRun);
  // A running run nobody moved for a while, with no agent run of it still pending.
  const stalled = await db
    .select({ id: pipelineRun.id })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.status, 'running'),
        lt(pipelineRun.updatedAt, new Date(Date.now() - STALL_MS)),
        sql`not exists (
          select 1 from ${pipelineRunStep}
          join ${agentRun} on ${agentRun.id} = ${pipelineRunStep.agentRunId}
          where ${pipelineRunStep.runId} = ${pipelineRun.id} and ${agentRun.status} = 'pending'
        )`,
        sql`not exists (
          select 1 from ${pipelineRunStep}
          where ${pipelineRunStep.runId} = ${pipelineRun.id}
            and coalesce(${pipelineRunStep.finishedAt}, ${pipelineRunStep.startedAt})
              > now() - make_interval(secs => ${STALL_MS / 1000})
        )`,
      ),
    );
  const schedules = await db
    .select({
      cron: helenaSchedule.cron,
      timezone: helenaSchedule.timezone,
      firedThrough: helenaSchedule.firedThrough,
    })
    .from(helenaSchedule)
    .where(eq(helenaSchedule.enabled, true));
  // A schedule whose time passed a while ago without the engine firing it.
  const overdueBefore = Date.now() - SCHEDULE_OVERDUE_MS;
  const overdue = schedules.filter(
    (row) =>
      (nextFireTime(row.cron, row.timezone, row.firedThrough)?.getTime() ?? Infinity) <
      overdueBefore,
  ).length;
  const failures = await db
    .select({
      runId: pipelineRun.id,
      projectKey: project.key,
      name: sql<string>`coalesce(${pipeline.name}, ${pipelineRun.title}, '')`,
      error: pipelineRun.error,
      at: pipelineRun.finishedAt,
    })
    .from(pipelineRun)
    .innerJoin(project, eq(project.id, pipelineRun.projectId))
    .leftJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .where(unresolvedPipelineFailure)
    .orderBy(desc(pipelineRun.finishedAt))
    .limit(5);
  const explained = await runFailures(failures.map((row) => row.runId));
  return {
    running: engineRunning(),
    executorId: engineRunning() ? engineExecutorId() : null,
    queued: counts?.queued ?? 0,
    active: counts?.active ?? 0,
    waiting: counts?.waiting ?? 0,
    failedLastDay: counts?.failedLastDay ?? 0,
    stalled: stalled.length,
    schedules: schedules.length,
    overdueSchedules: overdue,
    lastErrors: failures.map((row) => ({
      runId: row.runId,
      projectKey: row.projectKey,
      name: row.name,
      error: row.error ?? '',
      failure: explained.get(row.runId) ?? null,
      at: row.at ? iso(row.at) : '',
    })),
  };
}

// The runner is seen when it polls. Its service wrapper reports when it cannot start it at
// all; that report counts until an agent is seen again after it.
function runnerHealth(
  reported: { lastSeenAt: Date | null; checkedAt: Date; error: string | null } | undefined,
  lastSeenAt: Date | null,
): { lastSeenAt: Date | null; error: string | null } {
  const failed =
    reported?.error && (!lastSeenAt || reported.checkedAt.getTime() >= lastSeenAt.getTime());
  return { lastSeenAt, error: failed ? reported.error : null };
}

export async function systemHealth() {
  const [reported, [runner], runs, engine, janitors, agents, logins, models, vault] =
    await Promise.all([
      db.select().from(serviceHeartbeat),
      db
        .select({ lastSeenAt: sql`max(${aiAgent.lastSeenAt})`.mapWith(aiAgent.lastSeenAt) })
        .from(aiAgent)
        .where(eq(aiAgent.kind, 'external')),
      runCounts(),
      engineHealth(),
      listJanitorRuns(),
      runtimeSyncSummary(),
      runtimeLogins(),
      modelAvailabilityHealth(),
      vaultIntegrity(),
    ]);
  const byService = new Map(reported.map((row) => [row.service, row]));
  const byJanitor = new Map(janitors.map((row) => [row.job, row]));
  return {
    agents,
    logins,
    services: SERVICES.map((service) =>
      health(
        service,
        service === 'runner'
          ? runnerHealth(byService.get('runner'), runner?.lastSeenAt ?? null)
          : byService.get(service),
      ),
    ),
    runs,
    engine,
    janitors: JANITOR_JOBS.map((job) => janitorHealth(job, byJanitor.get(job))),
    models,
    vault,
  };
}
