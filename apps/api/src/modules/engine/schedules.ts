import { createHash } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { Cron } from 'croner';
import {
  db,
  helenaSchedule,
  pipeline,
  pipelineRun,
  pipelineVersion,
  projectPipeline,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getMembership } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { engineRunning } from './dbos';
import { fireWorkflow } from './workflows';

// Schedules: Helena keeps what a person sees and edits (helena_schedule, the source of
// truth) and the engine keeps a DBOS schedule of the same name in step with it, which
// fires every scheduled time exactly once, also across replicas, and fires the times it
// missed while it was down when it starts again. `planFire` turns one fire into a run
// under the schedule's catch-up policy.

export const DEFAULT_TIMEZONE = 'Europe/Berlin';

// A fire that starts this much after its time is late: the work of a routine belongs to
// the time it was scheduled for.
export const MISSED_GRACE_MS = 10 * 60_000;

export type ScheduleRow = typeof helenaSchedule.$inferSelect;

function parseCron(expression: string, timezone: string): Cron {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new HttpError(400, 'Invalid time zone');
  }
  // The engine's scheduler reads classic five-field cron: numbers, names, ranges, lists
  // and steps. The extensions some parsers take (L, W, #, ?) are refused.
  if (!/^[0-9A-Za-z*/,\- ]+$/.test(expression) || /\b[LW]\b|#|\?/.test(expression))
    throw new HttpError(400, 'Invalid cron expression');
  if (expression.trim().split(/\s+/).length !== 5)
    throw new HttpError(400, 'Invalid cron expression');
  try {
    return new Cron(expression, { timezone, paused: true });
  } catch {
    throw new HttpError(400, 'Invalid cron expression');
  }
}

export function assertCron(expression: string, timezone: string): void {
  parseCron(expression, timezone);
}

// The next time the cron fires after `after`, in its time zone.
export function nextFireTime(
  expression: string,
  timezone: string,
  after = new Date(),
): Date | null {
  try {
    return parseCron(expression, timezone).nextRun(after);
  } catch {
    return null;
  }
}

// ---- keeping the engine's schedules in step ----------------------------------------

function engineSchedule(row: ScheduleRow) {
  return {
    scheduleName: row.id,
    workflowFn: fireWorkflow,
    schedule: row.cron,
    context: { scheduleId: row.id },
    options: { automaticBackfill: true, cronTimezone: row.timezone },
  };
}

// Brings the engine's schedule of one row in line: one while the row is enabled, none
// otherwise. A schedule switched on again starts afresh, so the times it was off are not
// fired afterwards. Does nothing while the engine does not run here; the reconciliation
// of the next start does it then.
export async function syncEngineSchedule(id: string): Promise<void> {
  if (!engineRunning()) return;
  const [row] = await db.select().from(helenaSchedule).where(eq(helenaSchedule.id, id));
  const existing = await DBOS.getSchedule(id);
  if (!row || !row.enabled) {
    if (existing) await DBOS.deleteSchedule(id);
    return;
  }
  if (!existing) {
    await DBOS.createSchedule(engineSchedule(row));
    return;
  }
  if (existing.schedule !== row.cron || existing.cronTimezone !== row.timezone)
    await DBOS.updateSchedule(id, { schedule: row.cron, cronTimezone: row.timezone });
  if (existing.status !== 'ACTIVE') await DBOS.resumeSchedule(id);
}

// The periodic pass: every enabled row has its engine schedule, and no engine schedule
// is left without one. Returns how many it changed.
export async function reconcileEngineSchedules(): Promise<number> {
  if (!engineRunning()) return 0;
  const rows = await db.select().from(helenaSchedule);
  const engine = new Map((await DBOS.listSchedules()).map((item) => [item.scheduleName, item]));
  let changed = 0;
  for (const row of rows) {
    const existing = engine.get(row.id);
    engine.delete(row.id);
    const wanted = row.enabled;
    const differs =
      existing &&
      (existing.schedule !== row.cron ||
        existing.cronTimezone !== row.timezone ||
        existing.status !== 'ACTIVE');
    if ((wanted && (!existing || differs)) || (!wanted && existing)) {
      await syncEngineSchedule(row.id);
      changed += 1;
    }
  }
  for (const orphan of engine.keys()) {
    await DBOS.deleteSchedule(orphan);
    changed += 1;
  }
  return changed;
}

// ---- runs of a schedule ------------------------------------------------------------

function fireRunId(scheduleId: string, at: Date): string {
  return `fire-${createHash('sha256').update(`${scheduleId}\0${at.toISOString()}`).digest('hex').slice(0, 40)}`;
}

// The run a fire (or "Jetzt ausführen") records: a routine's delegation with the
// routine's current settings, or a run of the workflow's newest version on a task it
// creates. Once per schedule and time; an existing run is answered instead.
export async function recordScheduleRun(
  row: ScheduleRow,
  scheduledFor: Date,
  trigger: 'schedule' | 'manual',
  skipped: 'missed' | null = null,
  actorUserId: string | null = row.actorUserId,
): Promise<{ runId: string; created: boolean }> {
  const id = fireRunId(row.id, scheduledFor);
  const actor =
    actorUserId && (await getMembership(row.projectId, actorUserId)) ? actorUserId : null;
  const skippedFields = skipped
    ? {
        status: 'skipped',
        result: { outcome: 'skipped', skipReason: skipped },
        finishedAt: new Date(),
      }
    : {};
  let values: typeof pipelineRun.$inferInsert;
  if (row.kind === 'routine') {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      trigger: { type: 'routine' },
      roles: [],
      steps: [
        {
          id: 'dispatch',
          name: row.title,
          type: 'delegate',
          agentId: row.agentId ?? 0,
          title: row.title,
          instructions: row.instructions,
          mode: row.mode === 'reopen' ? 'reopen' : 'new',
          taskId: row.mode === 'reopen' ? row.taskId : null,
        },
      ],
    };
    values = {
      id,
      kind: 'routine',
      definition,
      title: row.title,
      projectId: row.projectId,
      agentId: row.agentId,
      scheduleId: row.id,
      scheduledFor,
      trigger,
      actorUserId: actor,
      ...skippedFields,
    };
  } else {
    const [version] = await db
      .select({
        id: pipelineVersion.id,
        name: pipeline.name,
        definition: pipelineVersion.definition,
        updatedBy: projectPipeline.updatedBy,
      })
      .from(pipeline)
      .innerJoin(
        pipelineVersion,
        and(
          eq(pipelineVersion.pipelineId, pipeline.id),
          eq(pipelineVersion.version, pipeline.version),
        ),
      )
      .leftJoin(
        projectPipeline,
        and(
          eq(projectPipeline.pipelineId, pipeline.id),
          eq(projectPipeline.projectId, row.projectId),
        ),
      )
      .where(eq(pipeline.id, row.pipelineId!));
    if (!version) throw new HttpError(404, 'Workflow not found');
    const trigger_ = (version.definition as PipelineDefinition).trigger;
    const title = trigger_.type === 'schedule' ? trigger_.title : version.name;
    values = {
      id,
      kind: 'workflow',
      pipelineId: row.pipelineId,
      versionId: version.id,
      projectId: row.projectId,
      scheduleId: row.id,
      scheduledFor,
      trigger,
      input: {
        task: { title, description: `Created by the scheduled workflow "${version.name}".` },
      },
      actorUserId: actor,
      ...skippedFields,
    };
  }
  const inserted = await db
    .insert(pipelineRun)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: pipelineRun.id });
  if (inserted.length > 0) await bumpControlPlaneRevision(row.projectId);
  const [existing] = inserted.length
    ? [{ id }]
    : await db
        .select({ id: pipelineRun.id })
        .from(pipelineRun)
        .where(and(eq(pipelineRun.scheduleId, row.id), eq(pipelineRun.scheduledFor, scheduledFor)));
  return { runId: existing?.id ?? id, created: inserted.length > 0 };
}

// One fire of a schedule, under its catch-up policy. The engine fires every scheduled
// time once, the ones it missed while it was down included; a fire that comes more than
// the grace late runs only when it is the newest time the schedule missed and the
// schedule says "run once", is recorded as missed when it is the newest and the schedule
// says "skip", and is dropped otherwise. Answers the run to start, or null.
export async function planFire(scheduleId: string, scheduledAtIso: string, now = Date.now()) {
  const [row] = await db.select().from(helenaSchedule).where(eq(helenaSchedule.id, scheduleId));
  if (!row || !row.enabled) return null;
  const scheduledAt = new Date(scheduledAtIso);
  if (now - scheduledAt.getTime() > MISSED_GRACE_MS) {
    const next = nextFireTime(row.cron, row.timezone, scheduledAt);
    const newest = !next || next.getTime() > now;
    if (!newest) return null;
    if (row.catchUp === 'skip') {
      await recordScheduleRun(row, scheduledAt, 'schedule', 'missed');
      return null;
    }
  }
  const { runId } = await recordScheduleRun(row, scheduledAt, 'schedule');
  const [run] = await db
    .select({ status: pipelineRun.status })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return run?.status === 'pending' ? runId : null;
}
