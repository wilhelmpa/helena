import { createHash } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { Cron } from 'croner';
import {
  db,
  agentRun,
  helenaSchedule,
  issue,
  pipeline,
  pipelineRun,
  pipelineVersion,
  projectPipeline,
  projectColumn,
} from '@repo/db';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getMembership } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { engineRunning } from './dbos';
import { fireWorkflow } from './workflows';
import { inspectRoutineGate, type RoutineGateResult } from './routine-gate';

// Schedules: helena_schedule holds what a person sees and edits, and when the engine
// last fired each one. The engine's tick fires the times that have come
// (fireDueSchedules), and `planFire` turns one fire into a run under the schedule's
// catch-up policy.

// The fallback of a schedule that names no time zone; the instance's default time zone
// (engine/settings.ts) is used where one is asked for.
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
  // Classic five-field cron: numbers, names, ranges, lists and steps. The extensions some
  // parsers take (L, W, #, ?) are refused, so every cron reads the same everywhere.
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

// ---- firing -------------------------------------------------------------------------

// Fires the schedules whose time has come: for every enabled schedule the newest
// scheduled time after `fired_through` and at or before `now`, once. The fire is a
// workflow whose id holds the schedule and the time, so replicas that tick at the same
// moment, a tick repeated after a crash and a clock set back fire each time once. Times
// the engine missed while it was down are older than the newest one and never run; the
// newest runs or is recorded as missed under the schedule's catch-up policy (planFire).
// Croner computes the times, as it does for the next run the UI shows: every local time
// fires once, the one that does not exist when summer time begins an hour later, the one
// that happens twice when it ends the first time.
export async function fireDueSchedules(now = new Date()): Promise<number> {
  if (!engineRunning()) return 0;
  const rows = await db
    .select({
      id: helenaSchedule.id,
      cron: helenaSchedule.cron,
      timezone: helenaSchedule.timezone,
      firedThrough: helenaSchedule.firedThrough,
    })
    .from(helenaSchedule)
    .where(and(eq(helenaSchedule.enabled, true), lt(helenaSchedule.firedThrough, now)));
  let fired = 0;
  for (const row of rows) {
    const due = latestFireTime(row.cron, row.timezone, row.firedThrough, now);
    if (!due) continue;
    const iso = due.toISOString();
    await DBOS.startWorkflow(fireWorkflow, { workflowID: `fire:${row.id}:${iso}` })(row.id, iso);
    // Only forward: a tick that comes late does not take back a newer one.
    await db
      .update(helenaSchedule)
      .set({ firedThrough: due })
      .where(and(eq(helenaSchedule.id, row.id), lt(helenaSchedule.firedThrough, due)));
    fired += 1;
  }
  return fired;
}

// Counted in scheduled times: a schedule that missed more than this many is looked at
// over its last day only.
const MAX_MISSED_TIMES = 5_000;

// The newest time the cron fires after `after` and at or before `now`, or null.
export function latestFireTime(
  expression: string,
  timezone: string,
  after: Date,
  now: Date,
): Date | null {
  let cron: Cron;
  try {
    cron = parseCron(expression, timezone);
  } catch {
    return null;
  }
  const windows = [after, new Date(Math.max(after.getTime(), now.getTime() - 86_400_000))];
  for (const from of windows) {
    let latest: Date | null = null;
    let next = cron.nextRun(from);
    for (let count = 0; next && next <= now && count < MAX_MISSED_TIMES; count += 1) {
      latest = next;
      next = cron.nextRun(next);
    }
    if (!next || next > now) return latest;
  }
  return null;
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
    .select({ status: pipelineRun.status, input: pipelineRun.input })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  if (row.kind === 'routine' && row.precheckEnabled && run?.status === 'pending') {
    const noWork = await routineHasNoWork(row, runId);
    if (noWork) {
      await db
        .update(pipelineRun)
        .set({
          status: 'skipped',
          result: { outcome: 'skipped', skipReason: 'no-work' },
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'pending')));
      await bumpControlPlaneRevision(row.projectId);
      return null;
    }
  }
  if (
    row.kind === 'routine' &&
    run?.status === 'pending' &&
    !(run.input as { gate?: unknown } | null)?.gate
  ) {
    let gate: RoutineGateResult;
    try {
      gate = await inspectRoutineGate(row, scheduledAt);
    } catch (error) {
      console.error('[routine-gate] preflight failed', error);
      gate = {
        mode: row.gateMode as RoutineGateResult['mode'],
        source: row.gateSource as RoutineGateResult['source'],
        recommendation: 'run',
        reason: 'Preflight failed; run continues.',
        counts: {},
        decisionId: null,
        confidence: null,
        status: 'error',
      };
    }
    const skip = gate.mode === 'active' && !!row.gateApprovedBy && gate.recommendation === 'skip';
    await db
      .update(pipelineRun)
      .set({
        input: { gate },
        ...(skip
          ? {
              status: 'skipped',
              result: { outcome: 'skipped', skipReason: 'gate' },
              finishedAt: new Date(),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'pending')));
    await bumpControlPlaneRevision(row.projectId);
    if (skip) return null;
  }
  return run?.status === 'pending' ? runId : null;
}

// A routine's due fire is itself work unless it would repeat an unfinished task.
// This cheap check runs before the engine starts a delegate step or an agent model.
async function routineHasNoWork(row: ScheduleRow, runId: string): Promise<boolean> {
  if (row.mode === 'reopen') {
    if (row.taskId == null) return false;
    const [active] = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.issueId, row.taskId), eq(agentRun.status, 'pending')))
      .limit(1);
    return Boolean(active);
  }
  const [previous] = await db
    .select({ issueId: pipelineRun.issueId })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.scheduleId, row.id),
        isNotNull(pipelineRun.issueId),
        inArray(pipelineRun.status, ['succeeded', 'skipped']),
        ne(pipelineRun.id, runId),
      ),
    )
    .orderBy(desc(pipelineRun.scheduledFor), desc(pipelineRun.createdAt))
    .limit(1);
  if (!previous?.issueId) return false;
  const [task] = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(
      and(
        eq(issue.id, previous.issueId),
        eq(issue.projectId, row.projectId),
        isNull(issue.archivedAt),
        inArray(projectColumn.stateType, ['backlog', 'unstarted', 'started']),
      ),
    )
    .limit(1);
  return Boolean(task);
}
