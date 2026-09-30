import { createHash, randomBytes } from 'node:crypto';
import { db, helenaBrowserTaskRun } from '@repo/db';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { recordUsage } from '#modules/agents/usage/service';
import { recordBrowserGatewayEvent } from '#modules/agent-browser-gateway/events';
import { costOfUsage, getModelPriceSettings } from '#modules/model-prices/service';
import { askSystemOne, loadConnection, type SystemOneReply } from './connection';
import type { EffectiveBrowserControl } from './settings';
import { effectiveBrowserControl } from './settings';
import { browserStageStillEnabled, captureBrowserStage } from './first-stage';
import { attachFinalFrame } from './frames';
import { withinFailsafe } from '#modules/decisions/service';
import { StageRevoked, withStageGuard } from '#modules/decisions/stage-request';
import { stageCircuitResult } from '#modules/decisions/first-stage';

// The rows of browser_task (helena_browser_task_run, docs/helena-decisions/browser-task.md §3.4):
// opened when the gateway starts a task (or the owner starts one in Browser 2.0), counted on
// every decision, filled step by step, closed with the result. The one-time token a task's
// decisions travel under is stored hashed and stops working when the task ends or expires.

export const TASK_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_STEPS_STORED = 80;

export type TaskRow = typeof helenaBrowserTaskRun.$inferSelect;

export function newTaskToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// The task a token belongs to, while it runs.
export async function taskByToken(token: unknown): Promise<TaskRow | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const [row] = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(
      and(
        eq(helenaBrowserTaskRun.tokenHash, hashToken(token)),
        isNull(helenaBrowserTaskRun.finishedAt),
        gt(helenaBrowserTaskRun.tokenExpiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

export interface OpenTask {
  taskId: number;
  taskToken: string;
  policy: 'jev';
  minConfidence: number | null;
  label: string;
  model: string;
}

// An agent's browser_task/check/choose: a new row under a new token.
export async function openAgentTask(input: {
  agentId: number;
  teamId: number;
  projectId: number | null;
  kind: 'task' | 'check' | 'choose';
  goal: string;
  mode: 'read' | 'act';
  maxSteps: number;
  startUrl: string | null;
  runId: number | null;
  chatMessageId: number | null;
  control: EffectiveBrowserControl;
}): Promise<OpenTask> {
  const connection = input.control.connection;
  if (!input.control.enabled || !connection) {
    throw new HttpError(
      409,
      "This project's browser has no decision model (Browser-Steuerung: Standard).",
    );
  }
  const { token, hash } = newTaskToken();
  const firstStageScope = await captureBrowserStage(input, input.control);
  const [row] = await db
    .insert(helenaBrowserTaskRun)
    .values({
      teamId: input.teamId,
      projectId: input.projectId,
      agentId: input.agentId,
      source: 'agent',
      kind: input.kind,
      backend: 'decision',
      credentialId: connection.credentialId,
      backendLabel: input.control.label,
      provider: connection.backend.providerName,
      policy: input.control.policy,
      modelConfigured: connection.model,
      firstStageScope,
      goal: input.goal.slice(0, 1000),
      mode: input.mode,
      maxSteps: input.maxSteps,
      startUrl: input.startUrl?.slice(0, 500) ?? null,
      status: 'running',
      runId: input.runId,
      chatMessageId: input.chatMessageId,
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + TASK_TOKEN_TTL_MS),
      startedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: helenaBrowserTaskRun.id });
  if (!row)
    throw new HttpError(
      409,
      'The optional Jev stage already ran for this work. Continue with step tools and its last snapshot.',
    );
  return {
    taskId: row!.id,
    taskToken: token,
    policy: input.control.policy,
    minConfidence: input.control.minConfidence,
    label: input.control.label,
    model: connection.model,
  };
}

// A Browser 2.0 run the gateway starts under the lab token it was given: the row exists already.
export async function openLabTask(
  labToken: string,
  control: EffectiveBrowserControl,
): Promise<OpenTask> {
  const row = await taskByToken(labToken);
  if (!row || row.source !== 'lab') throw new HttpError(404, 'This test run is over.');
  await db
    .update(helenaBrowserTaskRun)
    .set({ status: 'running', startedAt: row.startedAt ?? new Date() })
    .where(eq(helenaBrowserTaskRun.id, row.id));
  const connection = row.credentialId ? await loadConnection(row.credentialId) : null;
  if (!connection) throw new HttpError(409, 'The test run has no decision model connection.');
  return {
    taskId: row.id,
    taskToken: labToken,
    policy: row.policy === 'jev' ? 'jev' : control.policy,
    minConfidence: control.minConfidence,
    label: row.backendLabel,
    model: row.modelConfigured ?? connection.model,
  };
}

// One System One request of a running task, with its connection and key; counted on the row.
export async function taskSystemOne(
  token: unknown,
  request: { state: unknown; questions: Record<string, unknown> },
): Promise<SystemOneReply> {
  const row = await taskByToken(token);
  if (!row) throw new HttpError(404, 'The task is over or unknown.');
  if (row.cancelledAt) throw new HttpError(409, 'The task was cancelled.');
  if (!row.credentialId) throw new HttpError(409, 'The task has no decision model.');
  const connection = await loadConnection(row.credentialId);
  if (!connection) throw new HttpError(409, 'The decision model connection was deleted.');
  if (row.decisions >= row.maxSteps * 2 + 8)
    throw new HttpError(429, 'The task used up its decisions.');
  let reply: SystemOneReply;
  if (row.firstStageScope) {
    if (JSON.stringify(request).length > 16000) {
      await cancelOptionalStage(row.id);
      throw new HttpError(
        409,
        'This page exceeds the optional Jev stage limit. Continue with step tools.',
      );
    }
    const control = await effectiveBrowserControl({
      teamId: row.teamId,
      projectId: row.projectId,
      agentId: row.agentId ?? undefined,
    });
    try {
      reply = await withStageGuard(
        () => browserStageStillEnabled(row),
        undefined,
        (signal) =>
          withinFailsafe(connection, request, control.firstStage?.timeoutMs ?? 1000, signal, 0),
      );
      stageCircuitResult(row.teamId, connection.credentialId, true);
    } catch (error) {
      await cancelOptionalStage(row.id);
      if (!(error instanceof StageRevoked))
        stageCircuitResult(row.teamId, connection.credentialId, false);
      throw new HttpError(
        409,
        'The optional Jev stage stopped. Continue with the existing step tools and current page state.',
      );
    }
  } else {
    reply = await askSystemOne(connection, request);
  }
  await db
    .update(helenaBrowserTaskRun)
    .set({
      decisions: sql`${helenaBrowserTaskRun.decisions} + 1`,
      inputTokens: sql`${helenaBrowserTaskRun.inputTokens} + ${reply.inputTokens}`,
      outputTokens: sql`${helenaBrowserTaskRun.outputTokens} + ${reply.outputTokens}`,
      decisionMs: sql`${helenaBrowserTaskRun.decisionMs} + ${reply.latencyMs}`,
      modelReported: reply.model ?? row.modelReported,
      ...(reply.providerCostUsd !== null
        ? {
            providerCostUsd: sql`coalesce(${helenaBrowserTaskRun.providerCostUsd}, 0) + ${reply.providerCostUsd}`,
          }
        : {}),
    })
    .where(eq(helenaBrowserTaskRun.id, row.id));
  if (!(await browserStageStillEnabled(row)))
    throw new HttpError(409, 'The optional Jev stage was disabled. Continue with step tools.');
  return reply;
}

async function cancelOptionalStage(id: number): Promise<void> {
  await db
    .update(helenaBrowserTaskRun)
    .set({ cancelledAt: new Date() })
    .where(and(eq(helenaBrowserTaskRun.id, id), isNull(helenaBrowserTaskRun.cancelledAt)));
}

export async function taskActionAllowed(
  token: unknown,
  caller: {
    agentId: number;
    teamId: number;
    projectId: number | null;
    runId: number | null;
    chatMessageId: number | null;
  },
): Promise<boolean> {
  const row = await taskByToken(token);
  if (
    !row ||
    row.cancelledAt ||
    row.agentId !== caller.agentId ||
    row.teamId !== caller.teamId ||
    row.projectId !== caller.projectId ||
    row.runId !== caller.runId ||
    row.chatMessageId !== caller.chatMessageId
  )
    return false;
  return browserStageStillEnabled(row);
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

// A step as the gateway reports it: only the known fields, bounded, no values.
export function cleanStep(step: unknown): Record<string, unknown> | null {
  if (!step || typeof step !== 'object') return null;
  const s = step as Record<string, unknown>;
  const num = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const operation = text(s.operation, 20);
  if (!operation) return null;
  return {
    n: num(s.n),
    operation,
    element: text(s.element, 120),
    valueKey: text(s.valueKey, 60),
    option: text(s.option, 120),
    probability: num(s.probability),
    confidence: num(s.confidence),
    decisionMs: num(s.decisionMs),
    actionMs: num(s.actionMs),
    category: text(s.category, 20),
    url: text(s.url, 300),
    outcome: text(s.outcome, 200),
  };
}

// A step of a running task: stored, and shown in the browser's activity like the step tool's.
export async function taskProgress(token: unknown, step: unknown): Promise<{ cancelled: boolean }> {
  const row = await taskByToken(token);
  if (!row) return { cancelled: true };
  const clean = cleanStep(step);
  if (clean && (row.steps?.length ?? 0) < MAX_STEPS_STORED) {
    await db
      .update(helenaBrowserTaskRun)
      .set({ steps: sql`${helenaBrowserTaskRun.steps} || ${JSON.stringify([clean])}::jsonb` })
      .where(and(eq(helenaBrowserTaskRun.id, row.id), isNull(helenaBrowserTaskRun.finishedAt)));
    if (clean.category !== 'read' || clean.operation === 'CLICK') {
      await recordBrowserGatewayEvent({
        projectId: row.projectId,
        agentId: row.agentId,
        agentName: row.backendLabel ? `browser_task · ${row.backendLabel}` : 'browser_task',
        actor: 'agent',
        tool: 'browser_task',
        category: typeof clean.category === 'string' ? clean.category : null,
        target: `${clean.operation}${clean.element ? ` ${clean.element}` : ''}`.slice(0, 300),
      }).catch(() => {});
    }
  }
  return { cancelled: row.cancelledAt !== null || !(await browserStageStillEnabled(row)) };
}

const STATUSES = new Set([
  'done',
  'needs_agent',
  'needs_login',
  'needs_confirmation',
  'needs_approval',
  'denied',
  'blocked',
  'error',
  'stuck',
  'max_steps',
  'owner_took_over',
  'backend_error',
  'cancelled',
]);

// The task's end: its result on the row, its tokens in the usage ledger.
export async function finishTask(token: unknown, result: unknown): Promise<void> {
  const row = await taskByToken(token);
  if (!row) return;
  const r = (result ?? {}) as Record<string, unknown>;
  let status =
    r.status === 'likely_done'
      ? 'needs_agent'
      : typeof r.status === 'string' && STATUSES.has(r.status)
        ? r.status
        : 'error';
  if (row.firstStageScope && status === 'done' && !(await browserStageStillEnabled(row)))
    status = 'cancelled';
  const steps = Array.isArray(r.steps)
    ? r.steps.map(cleanStep).filter(Boolean).slice(0, MAX_STEPS_STORED)
    : null;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const duration =
    typeof r.durationMs === 'number' && Number.isFinite(r.durationMs)
      ? Math.round(r.durationMs)
      : null;
  const candidates = Array.isArray(r.candidates)
    ? r.candidates.slice(0, 5).map((c) => ({
        element: text((c as Record<string, unknown>)?.element, 120),
        probability: (c as Record<string, unknown>)?.probability,
      }))
    : undefined;
  const pending =
    r.pending && typeof r.pending === 'object' ? (r.pending as Record<string, unknown>) : null;
  const [done] = await db
    .update(helenaBrowserTaskRun)
    .set({
      status,
      summary: text(r.summary, 500),
      ...(steps && (!row.firstStageScope || steps.length >= row.steps.length) ? { steps } : {}),
      result: {
        url: text(r.url, 500),
        title: text(r.title, 200),
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        doneScore: typeof r.doneScore === 'number' ? r.doneScore : null,
        approvalId: typeof r.approvalId === 'number' ? r.approvalId : null,
        ...(candidates ? { candidates } : {}),
        ...(pending
          ? {
              pending: {
                operation: text(pending.operation, 20),
                element: text(pending.element, 120),
                category: text(pending.category, 20),
              },
            }
          : {}),
        ...(typeof r.pageText === 'string' ? { pageText: r.pageText.slice(0, 600) } : {}),
        ...(typeof r.completedPlanSteps === 'number'
          ? { completedPlanSteps: Math.max(0, Math.min(12, Math.floor(r.completedPlanSteps))) }
          : {}),
        ...(typeof r.failedAttempts === 'number'
          ? { failedAttempts: Math.max(0, Math.min(2, Math.floor(r.failedAttempts))) }
          : {}),
        ...(r.handoffWholeTask === true ? { handoffWholeTask: true } : {}),
      },
      durationMs: duration,
      ...(typeof r.inputTokens === 'number' && r.inputTokens > row.inputTokens
        ? { inputTokens: Math.round(r.inputTokens) }
        : {}),
      finishedAt: new Date(),
      tokenExpiresAt: new Date(),
      // The gateway's own count, where it saw more than the proxy (a check's single call).
      ...(typeof usage.calls === 'number' && usage.calls > row.decisions
        ? { decisions: usage.calls }
        : {}),
    })
    .where(and(eq(helenaBrowserTaskRun.id, row.id), isNull(helenaBrowserTaskRun.finishedAt)))
    .returning();
  if (!done) return;
  await ledger(done);
  // jev-browser's throwaway browser has no live view: a picture of its last page, as a file
  // in the vault.
  await attachFinalFrame(done, r.finalFrame);
}

// A task's tokens in the ledger (agent_usage, kind 'tool'), under the agent's run or chat answer.
async function ledger(row: TaskRow): Promise<void> {
  if (!row.agentId || row.inputTokens + row.outputTokens === 0) return;
  await recordUsage({
    agentId: row.agentId,
    projectId: row.projectId,
    runId: row.runId,
    chatMessageId: row.chatMessageId,
    kind: 'tool',
    spend: {
      runtime: 'browser-gateway',
      model: row.modelReported ?? row.modelConfigured,
      provider: row.provider,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      durationMs: row.durationMs,
    },
  }).catch(() => {});
}

// Tasks a gateway never finished (it restarted, a run was killed) end as expired, with their
// tokens counted.
export async function expireStaleTasks(): Promise<void> {
  const stale = await db
    .update(helenaBrowserTaskRun)
    .set({
      status: 'error',
      summary: 'The task ended without a result (expired).',
      finishedAt: new Date(),
    })
    .where(
      and(
        isNull(helenaBrowserTaskRun.finishedAt),
        lt(helenaBrowserTaskRun.tokenExpiresAt, sql`now()`),
      ),
    )
    .returning();
  for (const row of stale) await ledger(row);
}

// What a task cost, in euro: the backend's own figure where it gave one (Vercel), else the price
// table (Jev's price ships with it), else nothing for a local model.
export async function taskCostEur(row: TaskRow): Promise<number | null> {
  if (row.provider === 'local') return 0;
  if (row.providerCostUsd !== null) {
    const { usdToEur } = await getModelPriceSettings();
    return row.providerCostUsd * usdToEur;
  }
  const model = row.modelReported ?? row.modelConfigured;
  const priced = await costOfUsage(model, row.provider, {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  }).catch(() => null);
  if (priced !== null) return priced;
  if (model && /jev/i.test(model)) {
    const { usdToEur } = await getModelPriceSettings();
    return (row.inputTokens * 0.042 * usdToEur) / 1_000_000;
  }
  return null;
}
