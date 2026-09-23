import { createHash } from 'node:crypto';
import { Elysia } from 'elysia';
import {
  agentRun,
  aiAgent,
  db,
  issueActivity,
  project,
  projectMember,
  projectSetting,
} from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { authorizeControlRequest } from './home-agent-bootstrap';
import { agentRunConfig } from './modules/agents/core/run-queue';
import { listColumns } from './modules/columns/service';
import { getIssueBySequence, updateIssue } from './modules/issues/service';
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

  const key = settingKey('mastra-agent-run', idempotencyKey);
  const requestFingerprint = fingerprint({
    projectRef,
    taskRef,
    agentRef,
    prompt,
    execution,
    maxAttempts,
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
      await tx
        .update(agentRun)
        .set({
          status: 'pending',
          output: null,
          lastError: null,
          finishedAt: null,
          nextAttemptAt: new Date(),
        })
        .where(
          and(
            eq(agentRun.id, Number(value.runId)),
            eq(agentRun.status, 'failed'),
            sql`${agentRun.attempts} < ${Number(maxAttempts)}`,
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
    },
  };
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
  .post('/internal/orchestration/task-sync', ({ request }) =>
    respond(request, synchronizeHermesStage),
  );
