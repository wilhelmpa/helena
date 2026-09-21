import { randomUUID } from 'node:crypto';
import { db, projectAction, projectActionRun, projectActionRunStep } from '@repo/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

export type ActionTrigger = 'manual' | 'issue_state_changed' | 'issue_comment_added';
export type ActionRunStatus = 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ActionChain {
  rootEventId: string;
  depth: number;
}

export interface ClaimedActionRun {
  id: string;
  actionId: number | null;
  projectId: number;
  issueId: number | null;
  actorUserId: string | null;
  actionName: string;
  trigger: ActionTrigger;
  fromColumnId: number;
  toColumnId: number;
  rootEventId: string;
  depth: number;
  condition: unknown;
  effect: unknown;
  workflow: unknown;
  attempts: number;
}

export async function enqueueStateChangedActions(input: {
  tx: Transaction;
  projectId: number;
  issueId: number;
  actorUserId: string | null;
  fromColumnId: number;
  toColumnId: number;
  chain?: ActionChain;
}): Promise<void> {
  if (!input.actorUserId) return;
  const depth = input.chain?.depth ?? 0;
  if (depth > 10) return;
  const actions = await input.tx
    .select()
    .from(projectAction)
    .where(
      and(
        eq(projectAction.projectId, input.projectId),
        eq(projectAction.enabled, true),
        eq(projectAction.trigger, 'issue_state_changed'),
      ),
    )
    .orderBy(asc(projectAction.position), asc(projectAction.id));
  if (actions.length === 0) return;
  const rootEventId = input.chain?.rootEventId ?? randomUUID();
  await input.tx
    .insert(projectActionRun)
    .values(
      actions.map((action) => ({
        actionId: action.id,
        projectId: input.projectId,
        issueId: input.issueId,
        actorUserId: input.actorUserId,
        actionName: action.name,
        trigger: 'issue_state_changed',
        fromColumnId: input.fromColumnId,
        toColumnId: input.toColumnId,
        rootEventId,
        depth,
        condition: action.condition,
        effect: action.effect,
        workflow: action.workflow,
      })),
    )
    .onConflictDoNothing();
}

export async function enqueueCommentAddedActions(input: {
  tx: Transaction;
  projectId: number;
  issueId: number;
  actorUserId: string | null;
  columnId: number;
  rootEventId: string;
}): Promise<void> {
  if (!input.actorUserId) return;
  const actions = await input.tx
    .select()
    .from(projectAction)
    .where(
      and(
        eq(projectAction.projectId, input.projectId),
        eq(projectAction.enabled, true),
        eq(projectAction.trigger, 'issue_comment_added'),
      ),
    )
    .orderBy(asc(projectAction.position), asc(projectAction.id));
  if (actions.length === 0) return;
  await input.tx
    .insert(projectActionRun)
    .values(
      actions.map((action) => ({
        actionId: action.id,
        projectId: input.projectId,
        issueId: input.issueId,
        actorUserId: input.actorUserId,
        actionName: action.name,
        trigger: 'issue_comment_added',
        fromColumnId: input.columnId,
        toColumnId: input.columnId,
        rootEventId: input.rootEventId,
        depth: 0,
        condition: action.condition,
        effect: action.effect,
        workflow: action.workflow,
      })),
    )
    .onConflictDoNothing();
}

export async function createManualActionRun(input: {
  actionId: number;
  projectId: number;
  issueId: number;
  actorUserId: string;
  actionName: string;
  columnId: number;
  condition: unknown;
  effect: unknown;
  workflow?: unknown;
}): Promise<ClaimedActionRun> {
  const { columnId, workflow = null, ...values } = input;
  const [row] = await db
    .insert(projectActionRun)
    .values({
      ...values,
      workflow,
      trigger: 'manual',
      fromColumnId: columnId,
      toColumnId: columnId,
      rootEventId: randomUUID(),
      status: 'running',
      attempts: 1,
      nextAttemptAt: sql`now() + interval '60 seconds'`,
      startedAt: new Date(),
    })
    .returning();
  return row as ClaimedActionRun;
}

export async function claimActionRuns(limit = 10): Promise<ClaimedActionRun[]> {
  await db.execute(sql`
    UPDATE project_action_run
       SET status = 'failed',
           last_error = 'Worker lease expired too many times',
           finished_at = now(),
           updated_at = now()
     WHERE status = 'running'
       AND (trigger = 'manual' OR attempts >= 3)
       AND next_attempt_at <= now()
  `);
  const rows = await db.execute(sql`
    UPDATE project_action_run r
       SET status = 'running',
           attempts = r.attempts + 1,
           started_at = coalesce(r.started_at, now()),
           next_attempt_at = now() + interval '60 seconds',
           updated_at = now()
     WHERE r.id IN (
       SELECT id
         FROM project_action_run q
        WHERE q.status IN ('pending', 'running')
          AND q.trigger IN ('issue_state_changed', 'issue_comment_added')
          AND q.attempts < 3
          AND q.next_attempt_at <= now()
        ORDER BY q.next_attempt_at, q.created_at, q.id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING
      r.id,
      r.action_id AS "actionId",
      r.project_id AS "projectId",
      r.issue_id AS "issueId",
      r.actor_user_id AS "actorUserId",
      r.action_name AS "actionName",
      r.trigger,
      r.from_column_id AS "fromColumnId",
      r.to_column_id AS "toColumnId",
      r.root_event_id AS "rootEventId",
      r.depth,
      r.condition,
      r.effect,
      r.workflow,
      r.attempts
  `);
  return rows as unknown as ClaimedActionRun[];
}

export async function finishActionRun(
  id: string,
  status: Extract<ActionRunStatus, 'succeeded' | 'skipped'>,
  changedFields: string[],
  message?: string,
): Promise<void> {
  await db
    .update(projectActionRun)
    .set({
      status,
      result: { changedFields },
      lastError: message ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectActionRun.id, id));
}

export async function failActionRun(run: ClaimedActionRun, error: string): Promise<void> {
  const retry = run.trigger !== 'manual' && run.attempts < 3;
  await db
    .update(projectActionRun)
    .set({
      status: retry ? 'pending' : 'failed',
      nextAttemptAt: retry ? sql`now() + make_interval(secs => ${run.attempts * 5})` : new Date(),
      lastError: error.slice(0, 500),
      finishedAt: retry ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectActionRun.id, run.id));
}

export async function getCurrentActionState(ids: number[]): Promise<
  Map<
    number,
    {
      enabled: boolean;
      trigger: ActionTrigger;
    }
  >
> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: projectAction.id,
      enabled: projectAction.enabled,
      trigger: projectAction.trigger,
    })
    .from(projectAction)
    .where(inArray(projectAction.id, ids));
  return new Map(
    rows.map((row) => [row.id, { enabled: row.enabled, trigger: row.trigger as ActionTrigger }]),
  );
}

export async function startActionRunStep(
  runId: string,
  nodeId: string,
  nodeType: 'trigger' | 'condition' | 'action',
): Promise<{ execute: boolean; result: unknown }> {
  await db
    .insert(projectActionRunStep)
    .values({ runId, nodeId, nodeType, status: 'pending' })
    .onConflictDoNothing();
  const [current] = await db
    .select({ status: projectActionRunStep.status, result: projectActionRunStep.result })
    .from(projectActionRunStep)
    .where(and(eq(projectActionRunStep.runId, runId), eq(projectActionRunStep.nodeId, nodeId)));
  if (current?.status === 'succeeded' || current?.status === 'skipped') {
    return { execute: false, result: current.result };
  }
  await db
    .update(projectActionRunStep)
    .set({
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(projectActionRunStep.runId, runId), eq(projectActionRunStep.nodeId, nodeId)));
  return { execute: true, result: null };
}

export async function finishActionRunStep(
  runId: string,
  nodeId: string,
  status: 'succeeded' | 'skipped',
  result: unknown,
): Promise<void> {
  await db
    .update(projectActionRunStep)
    .set({ status, result, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projectActionRunStep.runId, runId), eq(projectActionRunStep.nodeId, nodeId)));
}

export async function failActionRunStep(
  runId: string,
  nodeId: string,
  error: string,
): Promise<void> {
  await db
    .update(projectActionRunStep)
    .set({
      status: 'failed',
      lastError: error.slice(0, 500),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(projectActionRunStep.runId, runId), eq(projectActionRunStep.nodeId, nodeId)));
}
