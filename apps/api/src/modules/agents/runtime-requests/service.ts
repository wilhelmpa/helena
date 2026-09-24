import { setTimeout as sleep } from 'node:timers/promises';
import { db, agentRuntimeRequest, aiAgent } from '@repo/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import { HttpError, intEnv } from '#shared/lib';
import { touchRunner } from '../runner/service';

// The channel through which Helena asks an agent's runtime something: its sessions, a
// transcript, the logs, a health check, a curator run. Helena never opens the runtime's
// files; the runner next to the runtime answers with the runtime's own interfaces
// (packages/runner/src/readers). A request is a row the runner claims with a waiting call,
// like a chat message, and answers; the person's request waits for that answer.

// The requests a runner answers, as packages/runner/src/readers/types.ts names them.
export type RuntimeRequest =
  | { op: 'sessions.list'; limit?: number; offset?: number }
  | { op: 'sessions.search'; query: string; limit?: number }
  | { op: 'sessions.transcript'; sessionId: string; offset?: number; limit?: number }
  | { op: 'logs.read'; sessionId?: string | null; lines?: number; level?: string | null }
  | { op: 'health.check' }
  | { op: 'version.read' }
  | { op: 'curator.status' }
  | { op: 'curator.run' }
  | { op: 'curator.set'; action: 'pin' | 'unpin'; skill: string }
  | { op: 'estop.set'; engaged: boolean; reason?: string | null }
  | { op: 'runtime.update'; action: 'check' | 'apply' | 'status'; target?: string | null }
  | { op: 'limits.read'; force?: boolean };

// What a feature does with an answer as soon as it arrives, whoever is waiting for it: the
// plan limits a runner reports are stored even when nobody waits (the background loop).
type AnswerListener = (agentId: number, result: unknown) => Promise<void>;
const answerListeners = new Map<RuntimeRequest['op'], AnswerListener>();

export function onRuntimeAnswer(op: RuntimeRequest['op'], listener: AnswerListener): void {
  answerListeners.set(op, listener);
}

export const runtimeRequestConfig = {
  // How long a runner's claim waits for a request, and how often it looks.
  claimWaitMs: () => intEnv('AGENT_RUNTIME_REQUEST_CLAIM_WAIT_MS', 25_000),
  claimPollMs: () => intEnv('AGENT_RUNTIME_REQUEST_CLAIM_POLL_MS', 200),
  // How often a waiting person's request looks for the answer.
  answerPollMs: () => intEnv('AGENT_RUNTIME_REQUEST_ANSWER_POLL_MS', 150),
  // A runner that has not been seen for this long is taken as offline: a request to it
  // fails at once instead of waiting out its deadline.
  presenceSeconds: () => intEnv('AGENT_RUNTIME_REQUEST_PRESENCE_SECONDS', 120),
  // Answered rows, and rows nobody answered, are removed after this long.
  keepSeconds: () => intEnv('AGENT_RUNTIME_REQUEST_KEEP_SECONDS', 900),
};

// Past this the answer is refused; the runner asks for smaller pages on its side.
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

async function assertRunnerPresent(agentId: number): Promise<void> {
  const [row] = await db
    .select({
      kind: aiAgent.kind,
      seen: sql<boolean>`${aiAgent.lastSeenAt} > now() - make_interval(secs => ${runtimeRequestConfig.presenceSeconds()})`,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!row) throw new HttpError(404, 'Agent not found');
  if (row.kind !== 'external') {
    throw new HttpError(409, 'This agent has no runtime of its own');
  }
  if (!row.seen) {
    throw new HttpError(503, "The agent's runner is not reachable");
  }
}

// Queues a request for the agent's runner and returns its id without waiting, for work that
// takes longer than a person waits (a curator run). Its state is read with getRuntimeRequest.
export async function queueRuntimeRequest(
  agentId: number,
  request: RuntimeRequest,
  userId: string | null,
): Promise<number> {
  await assertRunnerPresent(agentId);
  const [row] = await db
    .insert(agentRuntimeRequest)
    .values({ agentId, request, requestedByUserId: userId })
    .returning({ id: agentRuntimeRequest.id });
  return row!.id;
}

export interface RuntimeRequestState {
  id: number;
  status: 'pending' | 'claimed' | 'answered' | 'failed';
  result: unknown;
  error: string | null;
}

export async function getRuntimeRequest(
  agentId: number,
  id: number,
): Promise<RuntimeRequestState | null> {
  const [row] = await db
    .select({
      id: agentRuntimeRequest.id,
      status: agentRuntimeRequest.status,
      result: agentRuntimeRequest.result,
      error: agentRuntimeRequest.error,
    })
    .from(agentRuntimeRequest)
    .where(and(eq(agentRuntimeRequest.id, id), eq(agentRuntimeRequest.agentId, agentId)));
  return row ? { ...row, status: row.status as RuntimeRequestState['status'] } : null;
}

// Asks the agent's runtime and waits for the answer. 503 when the runner is offline, 504
// when it did not answer in time, 502 with the runtime's reason when it could not answer.
export async function askRuntime<T = unknown>(
  agentId: number,
  request: RuntimeRequest,
  options: { userId: string | null; timeoutMs?: number },
): Promise<T> {
  const id = await queueRuntimeRequest(agentId, request, options.userId);
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  for (;;) {
    const state = await getRuntimeRequest(agentId, id);
    if (state?.status === 'answered') return state.result as T;
    if (state?.status === 'failed') {
      throw new HttpError(
        /not found/i.test(state.error ?? '') ? 404 : 502,
        state.error ?? 'The runtime could not answer',
      );
    }
    if (!state || Date.now() >= deadline) break;
    await sleep(runtimeRequestConfig.answerPollMs());
  }
  await db
    .update(agentRuntimeRequest)
    .set({ status: 'failed', error: 'Timed out', answeredAt: new Date() })
    .where(and(eq(agentRuntimeRequest.id, id), sql`${agentRuntimeRequest.status} <> 'answered'`));
  throw new HttpError(504, 'The runtime did not answer in time');
}

export interface ClaimedRuntimeRequest {
  id: number;
  request: RuntimeRequest;
}

// The runner's side: takes the agent's oldest waiting request, waiting up to the claim
// deadline for one to arrive.
export async function claimRuntimeRequest(agentId: number): Promise<ClaimedRuntimeRequest | null> {
  await touchRunner(agentId);
  const deadline = Date.now() + runtimeRequestConfig.claimWaitMs();
  for (;;) {
    const rows = await db.execute(sql`
      UPDATE agent_runtime_request r
      SET status = 'claimed', claimed_at = now()
      WHERE r.id = (
        SELECT id FROM agent_runtime_request q
        WHERE q.agent_id = ${agentId} AND q.status = 'pending'
        ORDER BY q.id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING r.id, r.request
    `);
    const row = (rows as unknown as { id: number; request: RuntimeRequest }[])[0];
    if (row) return { id: row.id, request: row.request };
    if (Date.now() >= deadline) return null;
    await sleep(runtimeRequestConfig.claimPollMs());
  }
}

// The runner's answer to a request it claimed. False when the request is not this agent's
// or was already closed (it timed out meanwhile).
export async function answerRuntimeRequest(
  agentId: number,
  id: number,
  answer: { ok: true; result: unknown } | { ok: false; error: string },
): Promise<boolean> {
  if (
    answer.ok &&
    Buffer.byteLength(JSON.stringify(answer.result ?? null), 'utf8') > MAX_ANSWER_BYTES
  ) {
    answer = { ok: false, error: 'The answer is too large' };
  }
  const rows = await db
    .update(agentRuntimeRequest)
    .set(
      answer.ok
        ? { status: 'answered', result: answer.result ?? null, answeredAt: new Date() }
        : { status: 'failed', error: answer.error.slice(0, 500), answeredAt: new Date() },
    )
    .where(
      and(
        eq(agentRuntimeRequest.id, id),
        eq(agentRuntimeRequest.agentId, agentId),
        eq(agentRuntimeRequest.status, 'claimed'),
      ),
    )
    .returning({ id: agentRuntimeRequest.id, request: agentRuntimeRequest.request });
  const op = (rows[0]?.request as { op?: RuntimeRequest['op'] } | undefined)?.op;
  const listener = op ? answerListeners.get(op) : undefined;
  if (listener && answer.ok) {
    await listener(agentId, answer.result).catch((error: unknown) => {
      console.error('[runtime-requests] answer listener failed:', error);
    });
  }
  return rows.length > 0;
}

// Janitor: requests older than the keep time, answered or not. A request nobody claimed in
// that time will not be claimed usefully any more: the person who asked stopped waiting.
export async function pruneRuntimeRequests(): Promise<number> {
  const rows = await db
    .delete(agentRuntimeRequest)
    .where(
      lt(
        agentRuntimeRequest.createdAt,
        sql`now() - make_interval(secs => ${runtimeRequestConfig.keepSeconds()})`,
      ),
    )
    .returning({ id: agentRuntimeRequest.id });
  return rows.length;
}
