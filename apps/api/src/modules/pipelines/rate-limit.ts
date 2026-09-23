import { randomUUID } from 'node:crypto';
import { db, pipelineRun } from '@repo/db';
import { and, count, eq, gte, isNull, like, notLike, or } from 'drizzle-orm';
import { recordActivity, rowSide } from '#modules/issues/activity';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { getProjectSetting, setProjectSetting } from '#shared/project-settings';
import { WORKFLOW_ACTOR } from './control';

// Guards against workflows re-triggering each other without end. queuePipelineTriggers
// (triggers.ts) starts a workflow on any task change except one a workflow makes
// itself — an agent step's change is not excluded, so workflow A's agent step can
// change the task in a way that starts workflow B, whose agent step changes it back,
// restarting A, forever. Plan cannot tell that chain apart from two workflows that
// legitimately hand a task back and forth a few times, so it bounds it instead: at
// most `maxRuns` runs of any workflow may start on one task within
// RUN_LIMIT_WINDOW_MINUTES. Past that, checkPipelineRunLimit refuses the run and
// leaves one trace of the refusal in the task's activity and in the workflow's own
// run history, so the person who put the workflows together can see why nothing
// started and change the limit if it was too tight for a real pipeline of theirs.
//
// The window is a fixed hour; `maxRuns` is the project's own setting (RUN_LIMIT_KEY
// in project_setting), defaulting to DEFAULT_MAX_RUNS.

export const RUN_LIMIT_WINDOW_MINUTES = 60;
const DEFAULT_MAX_RUNS = 10;
const MIN_MAX_RUNS = 1;
const MAX_MAX_RUNS = 1000;
const RUN_LIMIT_KEY = 'run_limit';

// The prefix that marks a pipeline_run row as the limiter's own trace rather than a
// run that was actually started: it must never count toward, or extend, a block.
const NOTICE_ERROR_PREFIX = 'workflow-run-limit:';

export interface PipelineRunLimitSettings {
  maxRuns: number;
  windowMinutes: number;
}

function normalizeMaxRuns(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_MAX_RUNS, Math.max(MIN_MAX_RUNS, n)) : DEFAULT_MAX_RUNS;
}

export async function getPipelineRunLimit(projectId: number): Promise<PipelineRunLimitSettings> {
  const stored = await getProjectSetting<{ maxRuns?: unknown }>(projectId, RUN_LIMIT_KEY);
  return {
    maxRuns: stored?.maxRuns == null ? DEFAULT_MAX_RUNS : normalizeMaxRuns(stored.maxRuns),
    windowMinutes: RUN_LIMIT_WINDOW_MINUTES,
  };
}

export async function setPipelineRunLimit(
  projectId: number,
  maxRuns: number,
): Promise<PipelineRunLimitSettings> {
  const normalized = normalizeMaxRuns(maxRuns);
  await setProjectSetting(projectId, RUN_LIMIT_KEY, { maxRuns: normalized });
  return { maxRuns: normalized, windowMinutes: RUN_LIMIT_WINDOW_MINUTES };
}

function windowStart(windowMinutes: number): Date {
  return new Date(Date.now() - windowMinutes * 60_000);
}

// Every run of any workflow started on the task within the window, the limiter's
// own notices excluded.
async function runsInWindow(issueId: number, windowMinutes: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.issueId, issueId),
        gte(pipelineRun.createdAt, windowStart(windowMinutes)),
        or(isNull(pipelineRun.error), notLike(pipelineRun.error, `${NOTICE_ERROR_PREFIX}%`)),
      ),
    );
  return row?.n ?? 0;
}

// Whether this workflow already left a notice on this task within the window: the
// loop the limiter guards against can retry the same trigger many times a minute,
// and one notice says what a hundred identical ones would not say any better.
async function alreadyNoticed(
  pipelineId: number,
  issueId: number,
  windowMinutes: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pipelineRun.id })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.pipelineId, pipelineId),
        eq(pipelineRun.issueId, issueId),
        gte(pipelineRun.createdAt, windowStart(windowMinutes)),
        like(pipelineRun.error, `${NOTICE_ERROR_PREFIX}%`),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function noticeRunLimited(
  pipelineRef: { id: number; versionId: number; name: string },
  task: { id: number; projectId: number },
  trigger: string,
  limit: PipelineRunLimitSettings,
): Promise<void> {
  if (await alreadyNoticed(pipelineRef.id, task.id, limit.windowMinutes)) return;
  // A 'rejected' run nothing ever started: it never touches the pending queue, and
  // the run history that lists a workflow's runs shows it exactly where the run
  // that did not start would have been, with why.
  await db.insert(pipelineRun).values({
    id: randomUUID(),
    pipelineId: pipelineRef.id,
    versionId: pipelineRef.versionId,
    projectId: task.projectId,
    issueId: task.id,
    trigger,
    dryRun: false,
    status: 'rejected',
    error:
      `${NOTICE_ERROR_PREFIX}${limit.maxRuns} runs per ${limit.windowMinutes} min reached on ` +
      'this task; this run was not started.',
    finishedAt: new Date(),
  });
  await recordActivity(
    task.id,
    [{ action: 'workflow_run_limited', subject: rowSide(pipelineRef.name, pipelineRef.id) }],
    WORKFLOW_ACTOR,
  );
  await bumpControlPlaneRevision(task.projectId);
}

// Whether `pipelineRef` may start another run on `task` right now. False leaves the
// activity entry and the run-history notice described above; call once per matched
// trigger, right before createRun.
export async function checkPipelineRunLimit(
  pipelineRef: { id: number; versionId: number; name: string },
  task: { id: number; projectId: number },
  trigger: string,
): Promise<boolean> {
  const limit = await getPipelineRunLimit(task.projectId);
  const runs = await runsInWindow(task.id, limit.windowMinutes);
  if (runs < limit.maxRuns) return true;
  await noticeRunLimited(pipelineRef, task, trigger, limit);
  return false;
}
