import { randomUUID } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { db, helenaSystemJob } from '@repo/db';
import { and, eq, lt } from 'drizzle-orm';
import { engineRunning } from './dbos';
import { latestFireTime, nextFireTime } from './schedules';

// Instance-level jobs of the engine: work that belongs to no project and that the owner
// schedules in the Administrator (the update center's check is the first). The same model
// as the schedules of routines and workflows (docs/helena-decisions/workflow-engine.md):
// croner computes the times, `helena_system_job.fired_through` holds how far a job is
// handled, and each time fires the DBOS workflow `helena.job` under the id
// `job:<job>:<time>`, so replicas and a repeated tick fire it once. "Jetzt ausführen"
// starts the same workflow under a manual id. A job's run is durable: its steps are
// recorded, and a restart continues after the last one that finished.

export interface SystemJobSchedule {
  enabled: boolean;
  cron: string;
  timezone: string;
}

// What a job's run does its work with: named steps (recorded once, replayed after a
// restart) and durable sleeps.
export interface SystemJobContext {
  trigger: 'schedule' | 'manual';
  scheduledFor: Date | null;
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(ms: number): Promise<void>;
}

export interface SystemJob {
  // `helena.updates`; a plugin's under its own id.
  id: string;
  schedule(): Promise<SystemJobSchedule>;
  run(context: SystemJobContext): Promise<void>;
}

const jobs = new Map<string, SystemJob>();

export function registerSystemJob(job: SystemJob): void {
  jobs.set(job.id, job);
}

export function systemJob(id: string): SystemJob | undefined {
  return jobs.get(id);
}

function scheduleKey(schedule: SystemJobSchedule): string {
  return `${schedule.cron}|${schedule.timezone}`;
}

async function jobRow(job: SystemJob, schedule: SystemJobSchedule, now: Date) {
  const key = scheduleKey(schedule);
  const [row] = await db.select().from(helenaSystemJob).where(eq(helenaSystemJob.id, job.id));
  if (row && row.scheduleKey === key) return row;
  // New, or given another time: it starts afresh now, like a schedule that was edited.
  const [saved] = await db
    .insert(helenaSystemJob)
    .values({ id: job.id, scheduleKey: key, firedThrough: now })
    .onConflictDoUpdate({
      target: helenaSystemJob.id,
      set: { scheduleKey: key, firedThrough: now },
    })
    .returning();
  return saved!;
}

// Fires the jobs whose time has come (the engine's quick tick). A time missed while the
// engine was down fires once when it comes back, if it is the newest one missed.
export async function fireDueSystemJobs(now = new Date()): Promise<number> {
  if (!engineRunning()) return 0;
  let fired = 0;
  for (const job of jobs.values()) {
    const schedule = await job.schedule();
    if (!schedule.enabled) continue;
    const row = await jobRow(job, schedule, now);
    const due = latestFireTime(schedule.cron, schedule.timezone, row.firedThrough, now);
    if (!due) continue;
    const iso = due.toISOString();
    await DBOS.startWorkflow(jobWorkflow, { workflowID: `job:${job.id}:${iso}` })(
      job.id,
      'schedule',
      iso,
    );
    await db
      .update(helenaSystemJob)
      .set({ firedThrough: due })
      .where(and(eq(helenaSystemJob.id, job.id), lt(helenaSystemJob.firedThrough, due)));
    fired += 1;
  }
  return fired;
}

async function record(
  id: string,
  values: Partial<typeof helenaSystemJob.$inferInsert>,
): Promise<void> {
  await db
    .insert(helenaSystemJob)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: helenaSystemJob.id, set: values });
}

// One run of a job: recorded as running, then succeeded or failed with the reason.
async function runJob(
  jobId: string,
  trigger: 'schedule' | 'manual',
  scheduledIso: string | null,
  context: Omit<SystemJobContext, 'trigger' | 'scheduledFor'>,
  workflowId: string | null,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Unknown system job ${jobId}`);
  await context.step('begin', () =>
    record(jobId, {
      lastStartedAt: new Date(),
      lastStatus: 'running',
      lastError: null,
      lastWorkflowId: workflowId,
      lastTrigger: trigger,
    }),
  );
  try {
    await job.run({
      ...context,
      trigger,
      scheduledFor: scheduledIso ? new Date(scheduledIso) : null,
    });
    await context.step('end', () =>
      record(jobId, { lastFinishedAt: new Date(), lastStatus: 'succeeded' }),
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await context.step('failed', () =>
      record(jobId, { lastFinishedAt: new Date(), lastStatus: 'failed', lastError: message }),
    );
    throw error;
  }
}

async function jobInWorkflow(
  jobId: string,
  trigger: 'schedule' | 'manual',
  scheduledIso: string | null,
): Promise<void> {
  await runJob(
    jobId,
    trigger,
    scheduledIso,
    {
      step: (name, fn) => DBOS.runStep(fn, { name: `helena.job:${name}` }),
      sleep: (ms) => DBOS.sleep(ms),
    },
    DBOS.workflowID ?? null,
  );
}

export const jobWorkflow = DBOS.registerWorkflow(jobInWorkflow, { name: 'helena.job' });

// "Jetzt ausführen". With the engine running the run is a durable workflow; without it
// (HELENA_ENGINE=off) it runs in this process, and a restart ends it. A run that is going
// is not started twice.
export async function runSystemJobNow(jobId: string): Promise<{ started: boolean }> {
  if (!jobs.has(jobId)) throw new Error(`Unknown system job ${jobId}`);
  const [row] = await db.select().from(helenaSystemJob).where(eq(helenaSystemJob.id, jobId));
  const staleAfter = 60 * 60_000;
  if (
    row?.lastStatus === 'running' &&
    row.lastStartedAt &&
    Date.now() - row.lastStartedAt.getTime() < staleAfter
  ) {
    return { started: false };
  }
  if (engineRunning()) {
    await DBOS.startWorkflow(jobWorkflow, { workflowID: `job:${jobId}:manual:${randomUUID()}` })(
      jobId,
      'manual',
      null,
    );
  } else {
    void runJob(
      jobId,
      'manual',
      null,
      { step: (_name, fn) => fn(), sleep: (ms) => Bun.sleep(ms) },
      null,
    ).catch((error: unknown) => console.error(`[engine] system job ${jobId} failed:`, error));
  }
  return { started: true };
}

export interface SystemJobState {
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: 'running' | 'succeeded' | 'failed' | null;
  lastError: string | null;
  lastTrigger: string | null;
  nextRunAt: string | null;
}

export async function systemJobState(jobId: string): Promise<SystemJobState> {
  const job = jobs.get(jobId);
  const [row] = await db.select().from(helenaSystemJob).where(eq(helenaSystemJob.id, jobId));
  const schedule = job ? await job.schedule() : null;
  return {
    lastStartedAt: row?.lastStartedAt?.toISOString() ?? null,
    lastFinishedAt: row?.lastFinishedAt?.toISOString() ?? null,
    lastStatus: (row?.lastStatus as SystemJobState['lastStatus']) ?? null,
    lastError: row?.lastError ?? null,
    lastTrigger: row?.lastTrigger ?? null,
    nextRunAt: schedule?.enabled
      ? (nextFireTime(schedule.cron, schedule.timezone)?.toISOString() ?? null)
      : null,
  };
}
