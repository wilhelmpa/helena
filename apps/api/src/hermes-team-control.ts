import { createHash } from 'node:crypto';
import { Elysia } from 'elysia';
import {
  agentRun,
  aiAgent,
  db,
  issue,
  issueActivity,
  project,
  projectMember,
  projectSetting,
} from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authorizeControlRequest } from './home-agent-bootstrap';
import { maxTurnsLimit, runBudgetSecondsLimit } from './modules/agents/model';
import { agentRunConfig } from './modules/agents/core/run-queue';
import { runLimit } from './modules/agents/core/service';
import { enforceAgentLimits } from './modules/agents/governance';
import { listColumns, type ColumnRow } from './modules/columns/service';
import {
  createIssue,
  enqueueDelegateRun,
  getIssueBySequence,
  restoreIssue,
  updateIssue,
  type IssueRow,
} from './modules/issues/service';
import { getMembership } from './modules/members/service';
import { getProjectByKey } from './modules/projects/service';
import { bumpControlPlaneRevision } from './modules/sync/service';

const REF = /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDEMPOTENCY = /^[a-f0-9]{64}$/;
const MAX_PROMPT = 48_000;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function ref(value: unknown, kind: string): string | null {
  const candidate = text(value, 160);
  return candidate && candidate.startsWith(`${kind}:`) && REF.test(candidate) ? candidate : null;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function settingKey(prefix: string, idempotencyKey: string): string {
  return `${prefix}:${idempotencyKey}`;
}

async function resolveTask(projectRef: string, taskRef: string) {
  const projectKey = projectRef.slice('project:'.length);
  const identifier = taskRef.slice('task:'.length);
  const match = /^(.+)-(\d+)$/.exec(identifier);
  if (!match || match[1] !== projectKey) return null;
  const [projectRow] = await db.select().from(project).where(eq(project.key, projectKey)).limit(1);
  if (!projectRow) return null;
  const task = await getIssueBySequence(projectRow.id, Number(match[2]));
  return task ? { project: projectRow, task } : null;
}

async function resolveAgent(projectId: number, agentRef: string) {
  const username = agentRef.slice('agent:'.length);
  const [row] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      kind: aiAgent.kind,
      model: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(eq(aiAgent.username, username))
    .limit(1);
  return row ?? null;
}

export async function enqueueHermesStage(body: unknown) {
  const input = object(body);
  const projectRef = ref(input?.projectRef, 'project');
  const taskRef = ref(object(input?.task)?.taskRef, 'task');
  const agentRef = ref(object(input?.agent)?.agentRef, 'agent');
  const idempotencyKey = text(input?.idempotencyKey, 64);
  const prompt = text(input?.prompt, MAX_PROMPT);
  if (
    !projectRef ||
    !taskRef ||
    !agentRef ||
    !idempotencyKey ||
    !IDEMPOTENCY.test(idempotencyKey) ||
    !prompt
  )
    return { status: 400, body: { error: 'Invalid Hermes stage request' } };
  const executionPolicy = object(input?.policy);
  const leaseBound = executionPolicy?.leaseSeconds ?? 300;
  const heartbeatBound = executionPolicy?.heartbeatSeconds ?? 60;
  const maxAttempts = executionPolicy?.maxAttempts ?? 3;
  if (!Number.isSafeInteger(leaseBound) || !Number.isSafeInteger(heartbeatBound))
    return { status: 400, body: { error: 'Invalid Hermes execution lease policy' } };
  if (
    !Number.isSafeInteger(maxAttempts) ||
    Number(maxAttempts) < 1 ||
    Number(maxAttempts) > agentRunConfig.maxAttempts()
  )
    return { status: 400, body: { error: 'Invalid Hermes retry limit' } };
  const maxTurns = runLimit(executionPolicy?.maxTurns, maxTurnsLimit);
  const runBudgetSeconds = runLimit(executionPolicy?.runBudgetSeconds, runBudgetSecondsLimit);
  if (
    (executionPolicy?.maxTurns != null && maxTurns === null) ||
    (executionPolicy?.runBudgetSeconds != null && runBudgetSeconds === null)
  )
    return { status: 400, body: { error: 'Invalid Hermes run budget' } };
  if (Number(leaseBound) < agentRunConfig.leaseSeconds() || Number(heartbeatBound) < 60)
    return {
      status: 409,
      body: {
        error: `Hermes runner requires a lease bound of at least ${agentRunConfig.leaseSeconds()} seconds and a heartbeat bound of at least 60 seconds`,
      },
    };
  const resolved = await resolveTask(projectRef, taskRef);
  if (!resolved) return { status: 404, body: { error: 'Project task not found' } };
  const agent = await resolveAgent(resolved.project.id, agentRef);
  if (!agent || agent.kind !== 'external')
    return { status: 409, body: { error: 'Project agent is not an external Hermes agent' } };

  const execution = object(input?.execution);
  const requestedModel = text(execution?.model, 256);
  const requestedReasoning = text(execution?.reasoning, 32);
  const policy = object(agent.runtimePolicy);
  const configuredReasoning = text(policy?.reasoningEffort, 32);
  if (
    (requestedModel && agent.model !== requestedModel) ||
    (requestedReasoning && configuredReasoning !== requestedReasoning)
  )
    return { status: 409, body: { error: 'Hermes agent execution settings do not match Plan' } };
  // Refused rather than queued, so the workflow run fails with the reason instead of
  // waiting on a run no runner claims.
  const refusal = await enforceAgentLimits(agent.id, resolved.project.id, resolved.task.id);
  if (refusal)
    return {
      status: 409,
      body: { error: `Hermes agent ${agentRef.slice('agent:'.length)} is paused: ${refusal}` },
    };

  const key = settingKey('mastra-agent-run', idempotencyKey);
  const requestFingerprint = fingerprint({
    projectRef,
    taskRef,
    agentRef,
    prompt,
    execution,
    maxAttempts,
    maxTurns: maxTurns ?? undefined,
    runBudgetSeconds: runBudgetSeconds ?? undefined,
  });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [stored] = await tx
      .select({ value: projectSetting.value })
      .from(projectSetting)
      .where(and(eq(projectSetting.projectId, resolved.project.id), eq(projectSetting.key, key)))
      .limit(1);
    const value = object(stored?.value);
    if (value) {
      if (value.fingerprint !== requestFingerprint)
        return { conflict: true as const, runId: 0, replayed: false };
      // A stage is asked for again after its run failed (a retry of the stage or of the
      // workflow run) or was canceled when Mastra stopped waiting (Mastra restarted and
      // continues the stage). The run is queued again with its claims counted anew;
      // Mastra bounds how often it asks.
      await tx
        .update(agentRun)
        .set({
          status: 'pending',
          attempts: 0,
          output: null,
          lastError: null,
          finishedAt: null,
          nextAttemptAt: new Date(),
        })
        .where(
          and(
            eq(agentRun.id, Number(value.runId)),
            inArray(agentRun.status, ['failed', 'canceled']),
          ),
        );
      return { conflict: false as const, runId: Number(value.runId), replayed: true };
    }
    const [run] = await tx
      .insert(agentRun)
      .values({
        agentId: agent.id,
        projectId: resolved.project.id,
        issueId: resolved.task.id,
        prompt,
        trigger: 'manual',
        maxTurns,
        runBudgetSeconds,
      })
      .returning({ id: agentRun.id });
    if (!run) throw new Error('Hermes stage could not be queued');
    await tx.insert(projectSetting).values({
      projectId: resolved.project.id,
      key,
      value: { fingerprint: requestFingerprint, runId: run.id, projectRef, taskRef, agentRef },
    });
    return { conflict: false as const, runId: run.id, replayed: false };
  });
  if (result.conflict)
    return { status: 409, body: { error: 'Idempotency key was reused with another request' } };
  await bumpControlPlaneRevision(resolved.project.id);
  return {
    status: 200,
    body: {
      runId: result.runId,
      replayed: result.replayed,
      projectRef,
      taskRef,
      agentRef,
      model: agent.model,
      reasoning: configuredReasoning,
    },
  };
}

export async function hermesStageStatus(body: unknown) {
  const input = object(body);
  const projectRef = ref(input?.projectRef, 'project');
  const runId = Number(input?.runId);
  if (!projectRef || !Number.isSafeInteger(runId) || runId < 1)
    return { status: 400, body: { error: 'Invalid Hermes run request' } };
  const [row] = await db
    .select({
      id: agentRun.id,
      status: agentRun.status,
      attempts: agentRun.attempts,
      output: agentRun.output,
      error: agentRun.lastError,
      createdAt: agentRun.createdAt,
      startedAt: agentRun.startedAt,
      finishedAt: agentRun.finishedAt,
      expiresAt: agentRun.nextAttemptAt,
      blockedQuestion: agentRun.blockedQuestion,
      projectId: project.id,
      projectKey: project.key,
    })
    .from(agentRun)
    .innerJoin(project, eq(project.id, agentRun.projectId))
    .where(eq(agentRun.id, runId))
    .limit(1);
  if (!row || projectRef !== `project:${row.projectKey}`)
    return { status: 404, body: { error: 'Hermes run not found' } };
  const heartbeatAt =
    row.attempts > 0
      ? new Date(row.expiresAt.getTime() - agentRunConfig.leaseSeconds() * 1_000)
      : null;
  return {
    status: 200,
    body: {
      runId: row.id,
      status: row.status,
      attempts: row.attempts,
      output: row.output,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      claimedAt: row.startedAt?.toISOString() ?? null,
      heartbeatAt: heartbeatAt?.toISOString() ?? null,
      expiresAt: row.attempts > 0 ? row.expiresAt.toISOString() : null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      blockedQuestion: row.blockedQuestion,
    },
  };
}

// Called by the bridge when the workflow run that waits on a stage was canceled. A run
// that already finished keeps its outcome; a runner executing the run learns of the
// cancel from its next heartbeat. Answers the status document, so a repeat gets the
// same answer.
export async function cancelHermesStage(body: unknown) {
  const found = await hermesStageStatus(body);
  if (found.status !== 200) return found;
  const [canceled] = await db
    .update(agentRun)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(and(eq(agentRun.id, Number(object(body)?.runId)), eq(agentRun.status, 'pending')))
    .returning({ projectId: agentRun.projectId });
  if (canceled) await bumpControlPlaneRevision(canceled.projectId);
  return hermesStageStatus(body);
}

function syncComment(summary: string, evidence: unknown): string {
  const entries = Array.isArray(evidence)
    ? evidence
        .map(object)
        .filter((item): item is JsonObject => Boolean(item))
        .slice(0, 40)
        .map((item) => {
          const label = text(item.label, 256);
          const evidenceRef = text(item.ref, 1_024);
          return label && evidenceRef ? `- ${label}: ${evidenceRef}` : null;
        })
        .filter((item): item is string => Boolean(item))
    : [];
  return [
    `## Agent team result`,
    summary.slice(0, 8_000),
    entries.length ? `### Evidence\n${entries.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function synchronizeHermesStage(body: unknown) {
  const input = object(body);
  const projectRef = ref(input?.projectRef, 'project');
  const taskRef = ref(input?.taskRef, 'task');
  const idempotencyKey = text(input?.idempotencyKey, 64);
  const state = input?.state === 'done' || input?.state === 'review' ? input.state : null;
  const summary = text(input?.summary, 8_000);
  if (
    !projectRef ||
    !taskRef ||
    !idempotencyKey ||
    !IDEMPOTENCY.test(idempotencyKey) ||
    !state ||
    !summary
  )
    return { status: 400, body: { error: 'Invalid Plan synchronization request' } };
  const resolved = await resolveTask(projectRef, taskRef);
  if (!resolved) return { status: 404, body: { error: 'Project task not found' } };
  const columns = await listColumns(resolved.project.id);
  const target =
    state === 'done'
      ? columns.find((column) => column.stateType === 'completed')
      : columns.find((column) => column.name.trim().toLowerCase() === 'review');
  if (!target)
    return {
      status: 409,
      body: { error: `Project has no ${state === 'done' ? 'completed' : 'Review'} state` },
    };
  const key = settingKey('mastra-task-sync', idempotencyKey);
  const requestFingerprint = fingerprint({
    projectRef,
    taskRef,
    state,
    summary,
    evidence: input?.evidence,
  });
  const commentBody = syncComment(summary, input?.evidence);
  const checkpoint = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [stored] = await tx
      .select({ value: projectSetting.value })
      .from(projectSetting)
      .where(and(eq(projectSetting.projectId, resolved.project.id), eq(projectSetting.key, key)))
      .limit(1);
    const value = object(stored?.value);
    if (value) return value.fingerprint === requestFingerprint ? value : { conflict: true };
    const [comment] = await tx
      .insert(issueActivity)
      .values({
        issueId: resolved.task.id,
        kind: 'comment',
        actorName: 'Mastra',
        body: commentBody,
      })
      .returning({ id: issueActivity.id });
    const valueToStore = {
      fingerprint: requestFingerprint,
      phase: 'commented',
      commentId: comment?.id ?? null,
      state,
    };
    await tx
      .insert(projectSetting)
      .values({ projectId: resolved.project.id, key, value: valueToStore });
    return valueToStore;
  });
  if ('conflict' in checkpoint && checkpoint.conflict === true)
    return {
      status: 409,
      body: { error: 'Idempotency key was reused with another synchronization' },
    };
  if (checkpoint.phase !== 'done') {
    if (resolved.task.columnId !== target.id)
      await updateIssue(resolved.task.id, { columnId: target.id }, { system: 'Mastra' });
    await db
      .update(projectSetting)
      .set({ value: { ...checkpoint, phase: 'done' }, updatedAt: new Date() })
      .where(and(eq(projectSetting.projectId, resolved.project.id), eq(projectSetting.key, key)));
  }
  await bumpControlPlaneRevision(resolved.project.id);
  return { status: 200, body: { idempotencyKey, synchronizedAt: new Date().toISOString(), state } };
}

type RoutineCheckpoint = {
  fingerprint: string;
  // 'pending' while the task is written but not yet delegated: a request with the
  // same key finishes the delegation.
  phase: 'pending' | 'done';
  outcome: 'created' | 'reopened' | 'skipped';
  taskRef: string;
};

class RoutineReplayed extends Error {}

function isOpenTask(task: IssueRow, columns: ColumnRow[]): boolean {
  const stateType = columns.find((column) => column.id === task.columnId)?.stateType;
  return !task.archivedAt && stateType !== 'completed' && stateType !== 'canceled';
}

async function readRoutineCheckpoint(
  executor: Pick<typeof db, 'select'>,
  projectId: number,
  key: string,
): Promise<RoutineCheckpoint | null> {
  const [stored] = await executor
    .select({ value: projectSetting.value })
    .from(projectSetting)
    .where(and(eq(projectSetting.projectId, projectId), eq(projectSetting.key, key)))
    .limit(1);
  return object(stored?.value) as RoutineCheckpoint | null;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The checkpoint stored under the key, read after waiting for any other request with
// the same key to finish its transaction.
async function lockRoutineCheckpoint(tx: Transaction, projectId: number, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  return readRoutineCheckpoint(tx, projectId, key);
}

// Stores the checkpoint of a routine request inside the transaction of the write it
// records. A checkpoint stored already was written by an earlier request with the same
// key, which is answered instead, and `write` does not happen.
async function claimRoutineCheckpoint(
  tx: Transaction,
  projectId: number,
  key: string,
  write: () => Promise<RoutineCheckpoint>,
): Promise<RoutineCheckpoint> {
  const stored = await lockRoutineCheckpoint(tx, projectId, key);
  if (stored) return stored;
  const value = await write();
  await tx.insert(projectSetting).values({ projectId, key, value });
  return value;
}

// Called by the bridge for each fire of a routine: creates a task delegated to the
// routine's agent, or reopens the task the routine names and delegates it again. The
// routine's task, the named one or the one it created last, blocks both while it is
// open, and the fire is answered as skipped. A repeated idempotency key answers what
// the first request did. The actor is the member the routine acts for, while they are
// in the project.
export async function dispatchRoutine(body: unknown) {
  const input = object(body);
  const projectRef = ref(input?.projectRef, 'project');
  const agentRef = ref(input?.agentRef, 'agent');
  const idempotencyKey = text(input?.idempotencyKey, 64);
  const title = text(input?.title, 300);
  const instructions = text(input?.instructions, 20_000);
  const mode = input?.mode === 'new' || input?.mode === 'reopen' ? input.mode : null;
  const taskRef = input?.taskRef === undefined ? undefined : ref(input.taskRef, 'task');
  const actorId = input?.actorId === undefined ? undefined : text(input.actorId, 200);
  if (
    !projectRef ||
    !agentRef ||
    !idempotencyKey ||
    !IDEMPOTENCY.test(idempotencyKey) ||
    !title ||
    !instructions ||
    !mode ||
    taskRef === null ||
    actorId === null ||
    (mode === 'reopen' && !taskRef)
  )
    return { status: 400, body: { error: 'Invalid routine request' } };
  const projectRow = await getProjectByKey(projectRef.slice('project:'.length));
  if (!projectRow) return { status: 404, body: { error: 'Project not found' } };
  const agent = await resolveAgent(projectRow.id, agentRef);
  if (!agent) return { status: 409, body: { error: 'The agent does not work in this project' } };

  const key = settingKey('mastra-routine', idempotencyKey);
  const requestFingerprint = fingerprint({
    projectRef,
    agentRef,
    title,
    instructions,
    mode,
    taskRef,
    actorId,
  });
  const answer = (checkpoint: RoutineCheckpoint) =>
    checkpoint.fingerprint === requestFingerprint
      ? {
          status: 200,
          body: { idempotencyKey, outcome: checkpoint.outcome, taskRef: checkpoint.taskRef },
        }
      : { status: 409, body: { error: 'Idempotency key was reused with another routine request' } };
  const stored = await readRoutineCheckpoint(db, projectRow.id, key);
  if (stored?.phase === 'done' || (stored && stored.fingerprint !== requestFingerprint))
    return answer(stored);

  const actor = actorId && (await getMembership(projectRow.id, actorId)) ? actorId : null;
  const finish = async (checkpoint: RoutineCheckpoint) => {
    await db
      .update(projectSetting)
      .set({ value: { ...checkpoint, phase: 'done' }, updatedAt: new Date() })
      .where(and(eq(projectSetting.projectId, projectRow.id), eq(projectSetting.key, key)));
    await bumpControlPlaneRevision(projectRow.id);
    return answer(checkpoint);
  };
  if (stored?.outcome === 'created') {
    const created = await resolveTask(projectRef, stored.taskRef);
    if (created) await enqueueDelegateRun(created.task, actor);
    return finish(stored);
  }

  const current = taskRef ? await resolveTask(projectRef, taskRef) : null;
  if (mode === 'reopen' && !current)
    return { status: 404, body: { error: 'Project task not found' } };
  const columns = await listColumns(projectRow.id);
  const checkpoint = (
    outcome: RoutineCheckpoint['outcome'],
    routineTask: string,
    phase: RoutineCheckpoint['phase'],
  ): RoutineCheckpoint => ({
    fingerprint: requestFingerprint,
    phase,
    outcome,
    taskRef: routineTask,
  });

  if (!stored && current && isOpenTask(current.task, columns)) {
    const skipped = await db.transaction((tx) =>
      claimRoutineCheckpoint(tx, projectRow.id, key, async () =>
        checkpoint('skipped', taskRef!, 'done'),
      ),
    );
    return answer(skipped);
  }
  const unstarted = columns.find((column) => column.stateType === 'unstarted');
  if (!unstarted) return { status: 409, body: { error: 'Project has no unstarted state' } };

  if (mode === 'new') {
    // The checkpoint is stored in the transaction that inserts the task, so a task
    // exists exactly when its checkpoint does. A request that finds one rolls its own
    // task back and leaves the delegation to the request that wrote it.
    let replayed = false;
    try {
      await createIssue(
        projectRow,
        { columnId: unstarted.id, title, description: instructions, delegateUserId: agent.userId },
        actor,
        {
          afterInsert: async (tx, issueId) => {
            if (await lockRoutineCheckpoint(tx, projectRow.id, key)) throw new RoutineReplayed();
            const [row] = await tx
              .select({ sequenceNumber: issue.sequenceNumber })
              .from(issue)
              .where(eq(issue.id, issueId));
            await tx.insert(projectSetting).values({
              projectId: projectRow.id,
              key,
              value: checkpoint(
                'created',
                `task:${projectRow.key}-${row!.sequenceNumber}`,
                'pending',
              ),
            });
          },
        },
      );
    } catch (error) {
      if (!(error instanceof RoutineReplayed)) throw error;
      replayed = true;
    }
    const created = (await readRoutineCheckpoint(db, projectRow.id, key))!;
    return replayed ? answer(created) : finish(created);
  }

  const task = current!.task;
  const reopened = await db.transaction((tx) =>
    claimRoutineCheckpoint(tx, projectRow.id, key, async () => {
      await tx.insert(issueActivity).values({
        issueId: task.id,
        kind: 'comment',
        actorName: 'Schedule',
        body: `Reopened by the schedule "${title}".\n\n${instructions}`,
      });
      return checkpoint('reopened', taskRef!, 'pending');
    }),
  );
  if (reopened.fingerprint !== requestFingerprint || reopened.phase === 'done')
    return answer(reopened);
  if (task.archivedAt) await restoreIssue(task.id, actor);
  const after = await updateIssue(
    task.id,
    { columnId: unstarted.id, delegateUserId: agent.userId },
    actor,
  );
  if (after && task.delegateUserId === agent.userId) await enqueueDelegateRun(after, actor);
  return finish(reopened);
}

async function respond(
  request: Request,
  operation: (body: unknown) => Promise<{ status: number; body: unknown }>,
) {
  const denied = await authorizeControlRequest(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const result = await operation(body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const hermesTeamControlRoutes = new Elysia({ name: 'hermes-team-control' })
  .post('/internal/orchestration/agent-run', ({ request }) => respond(request, enqueueHermesStage))
  .post('/internal/orchestration/agent-run/status', ({ request }) =>
    respond(request, hermesStageStatus),
  )
  .post('/internal/orchestration/agent-run/cancel', ({ request }) =>
    respond(request, cancelHermesStage),
  )
  .post('/internal/orchestration/task-sync', ({ request }) =>
    respond(request, synchronizeHermesStage),
  )
  .post('/internal/orchestration/routine', ({ request }) => respond(request, dispatchRoutine));
