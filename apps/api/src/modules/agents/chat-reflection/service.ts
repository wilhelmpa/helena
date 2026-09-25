import { agentChatMessage, agentChatThread, aiAgent, db, helenaChatReflection } from '@repo/db';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { intEnv } from '#shared/lib';
import { enforceBudgets } from '#modules/autopilot/budgets';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import { classModelNow } from '#modules/local-ai/service';
import { WORK_CLASS } from '#modules/local-ai/work-classes';
import { normalizeRuntimePolicy, type AgentRuntimeKind } from '../core/service';
import { touchRunner, type RunnerAgent } from '../runner/service';
import {
  chatReflectionPrompt,
  LOCAL_REFLECTION_LIMITS,
  LOCAL_REFLECTION_MAX_READ,
  REFLECTION_LIMITS,
} from '../runner/reflection';
import { recordUsage, type Spend } from '../usage/service';
import { chatReflectionDue, chatReflectionSettings } from './policy';

// Reflection on chats (docs/helena-decisions/agent-context.md §5). A run's reflection follows
// the run at once (runner/service.ts requestReflection); a chat has no end, so its reflection
// is queued after each answer for when the chat has gone quiet, or at once after many turns,
// and the agent's runner drains the queue like its chat answers. The thread's answers and its
// reflection continue the same Hermes session, so they never run at the same time: a
// reflection is handed out only while no answer of its thread waits or streams, and an answer
// only while no reflection of its thread is out (chat/service.ts claimMessage).

export const chatReflectionConfig = {
  // Longer than a reflection's budget with the runner's grace, so a live one is never taken
  // over.
  leaseSeconds: () => intEnv('HELENA_CHAT_REFLECTION_LEASE_SECONDS', 600),
  maxAttempts: () => intEnv('HELENA_CHAT_REFLECTION_MAX_ATTEMPTS', 2),
};

// After an answer of the agent in the thread succeeded (the chat-learning plugin's event
// subscriber): queues the thread's reflection, or moves the one that waits. Nothing for an
// agent that does not reflect on chats, and nothing while a reflection of the thread is out.
export async function scheduleChatReflection(input: {
  threadId: string;
  agentId: number;
  messageId: number;
  now?: Date;
}): Promise<void> {
  const [agent] = await db
    .select({ runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, input.agentId));
  if (!agent) return;
  const policy = normalizeRuntimePolicy(agent.runtimePolicy);
  const settings = chatReflectionSettings(policy, (policy.runtime ?? 'hermes') as AgentRuntimeKind);
  if (!settings.enabled) return;
  // The person's messages since the last reflection the thread finished or has waiting.
  const [last] = await db
    .select({ upto: helenaChatReflection.uptoMessageId })
    .from(helenaChatReflection)
    .where(
      and(
        eq(helenaChatReflection.threadId, input.threadId),
        inArray(helenaChatReflection.status, ['success', 'failed']),
      ),
    )
    .orderBy(desc(helenaChatReflection.uptoMessageId))
    .limit(1);
  const [counted] = await db
    .select({ turns: sql<number>`count(*)::int` })
    .from(agentChatMessage)
    .where(
      and(
        eq(agentChatMessage.threadId, input.threadId),
        eq(agentChatMessage.role, 'user'),
        gt(agentChatMessage.id, last?.upto ?? 0),
      ),
    );
  const due = chatReflectionDue(settings, counted?.turns ?? 0, input.now ?? new Date());
  if (!due) return;
  const values = {
    reason: due.reason,
    uptoMessageId: input.messageId,
    turns: counted?.turns ?? 0,
    nextAttemptAt: due.at,
  };
  // One waits per thread (a partial unique index); one that is out keeps its lease.
  await db
    .insert(helenaChatReflection)
    .values({ threadId: input.threadId, agentId: input.agentId, ...values })
    .onConflictDoUpdate({
      target: helenaChatReflection.threadId,
      targetWhere: sql`${helenaChatReflection.status} = 'pending'`,
      set: values,
      setWhere: sql`${helenaChatReflection.claimedAt} IS NULL`,
    });
}

export interface ChatReflectionClaim {
  id: number;
  threadId: string;
  claim: number;
  sessionId: string;
  // The answer it looks back to, which a runner names its work by.
  messageId: number;
  prompt: string;
  model: string | null;
  thinkingLevel: string | null;
  maxTurns: number;
  runBudgetSeconds: number;
}

interface ClaimedRow {
  id: number;
  threadId: string;
  claims: number;
  uptoMessageId: number;
}

// Hands out the agent's next due reflection under a lease, or null. Never while the instance
// is stopped, the agent paused, or an answer of the thread waits or streams. A reflection
// whose thread has no session left to continue is dropped.
export async function claimChatReflection(agent: RunnerAgent): Promise<ChatReflectionClaim | null> {
  await touchRunner(agent.id);
  if (await emergencyStopActive()) return null;
  await db
    .update(helenaChatReflection)
    .set({ status: 'failed', lastError: 'Runner did not report a result', finishedAt: new Date() })
    .where(
      and(
        eq(helenaChatReflection.agentId, agent.id),
        eq(helenaChatReflection.status, 'pending'),
        sql`${helenaChatReflection.attempts} >= ${chatReflectionConfig.maxAttempts()}`,
        sql`${helenaChatReflection.nextAttemptAt} <= now()`,
      ),
    );
  const rows = await db.execute(sql`
    UPDATE helena_chat_reflection r
    SET attempts = r.attempts + 1,
        claims = r.claims + 1,
        claimed_at = now(),
        next_attempt_at = now() + make_interval(secs => ${chatReflectionConfig.leaseSeconds()})
    WHERE r.id = (
      SELECT id FROM helena_chat_reflection q
      WHERE q.agent_id = ${agent.id}
        AND q.status = 'pending'
        AND q.next_attempt_at <= now()
        AND (SELECT paused_at FROM ai_agent a WHERE a.id = q.agent_id) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM agent_chat_message m
          WHERE m.thread_id = q.thread_id AND m.status IN ('pending', 'streaming')
        )
      ORDER BY q.next_attempt_at, q.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING r.id, r.thread_id AS "threadId", r.claims, r.upto_message_id AS "uptoMessageId"
  `);
  const row = (rows as unknown as ClaimedRow[])[0];
  if (!row) return null;
  // The session of the thread's latest answer, which the next answer resumes too.
  const [latest] = await db
    .select({
      id: agentChatMessage.id,
      sessionId: agentChatMessage.sessionId,
      inputTokens: agentChatMessage.inputTokens,
      model: agentChatThread.model,
      thinkingLevel: agentChatThread.thinkingLevel,
    })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(
      and(
        eq(agentChatMessage.threadId, row.threadId),
        // This agent's own session: a chat can switch agents between answers.
        eq(agentChatMessage.agentId, agent.id),
        eq(agentChatMessage.role, 'assistant'),
        eq(agentChatMessage.status, 'success'),
        isNotNull(agentChatMessage.sessionId),
      ),
    )
    .orderBy(desc(agentChatMessage.id))
    .limit(1);
  if (!latest?.sessionId) {
    await db
      .update(helenaChatReflection)
      .set({ status: 'canceled', lastError: 'The chat has no session', finishedAt: new Date() })
      .where(eq(helenaChatReflection.id, row.id));
    return null;
  }
  // Lokale KI's class `reflection` takes a small session, as for a run (runner/reflection.ts);
  // the thread's last call read at least what the session holds.
  const local =
    latest.inputTokens !== null && latest.inputTokens <= LOCAL_REFLECTION_MAX_READ
      ? await classModelNow(WORK_CLASS.reflection)
      : null;
  const settings = local?.model
    ? { model: local.model, thinkingLevel: local.thinkingLevel, ...LOCAL_REFLECTION_LIMITS }
    : {
        model: latest.model ?? agent.model,
        thinkingLevel: latest.model ? latest.thinkingLevel : agent.thinkingLevel,
        ...REFLECTION_LIMITS,
      };
  await db
    .update(helenaChatReflection)
    .set({ sessionId: latest.sessionId, model: settings.model })
    .where(eq(helenaChatReflection.id, row.id));
  return {
    id: row.id,
    threadId: row.threadId,
    claim: row.claims,
    sessionId: latest.sessionId,
    messageId: latest.id,
    prompt: chatReflectionPrompt(),
    ...settings,
  };
}

export interface ChatReflectionReport {
  status: 'success' | 'failed';
  saved: { tool: 'memory' | 'skill'; action: string; target: string }[];
  summary?: string | null;
  error?: string | null;
  usage?: { inputTokens: number; outputTokens: number } | null;
  spend?: Spend | null;
}

// Records what the runner reports for the reflection it holds. Its tokens count against the
// agent's budgets like a chat answer's. False when the reflection is not this agent's, was
// finished already, or was handed out again since.
export async function finishChatReflection(
  agent: RunnerAgent,
  id: number,
  claim: number | undefined,
  report: ChatReflectionReport,
): Promise<boolean> {
  await touchRunner(agent.id);
  const rows = await db
    .update(helenaChatReflection)
    .set({
      status: report.status,
      saved: report.saved,
      summary: report.summary?.trim().slice(0, 2000) || null,
      lastError: report.status === 'failed' ? (report.error?.slice(0, 500) ?? 'Failed') : null,
      inputTokens: report.usage?.inputTokens ?? null,
      outputTokens: report.usage?.outputTokens ?? null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(helenaChatReflection.id, id),
        eq(helenaChatReflection.agentId, agent.id),
        eq(helenaChatReflection.status, 'pending'),
        isNotNull(helenaChatReflection.claimedAt),
        ...(claim === undefined ? [] : [eq(helenaChatReflection.claims, claim)]),
      ),
    )
    .returning({
      threadId: helenaChatReflection.threadId,
      sessionId: helenaChatReflection.sessionId,
      messageId: helenaChatReflection.uptoMessageId,
    });
  const row = rows[0];
  if (!row) return false;
  const [thread] = await db
    .select({ projectId: agentChatThread.projectId })
    .from(agentChatThread)
    .where(eq(agentChatThread.id, row.threadId));
  await recordUsage({
    agentId: agent.id,
    projectId: thread?.projectId ?? null,
    chatMessageId: row.messageId,
    kind: 'reflection',
    sessionId: row.sessionId,
    spend: report.spend,
  });
  await enforceBudgets(agent.id, thread?.projectId ?? null, null);
  return true;
}

export interface ChatReflectionView {
  id: number;
  threadId: string;
  threadTitle: string | null;
  reason: 'idle' | 'turns';
  status: 'pending' | 'running' | 'success' | 'failed' | 'canceled';
  turns: number;
  saved: ChatReflectionReport['saved'];
  summary: string | null;
  error: string | null;
  tokens: number | null;
  dueAt: string;
  finishedAt: string | null;
}

// The agent's latest chat reflections, for its learning settings.
export async function listChatReflections(
  agentId: number,
  limit = 10,
): Promise<ChatReflectionView[]> {
  const rows = await db
    .select({ reflection: helenaChatReflection, threadTitle: agentChatThread.title })
    .from(helenaChatReflection)
    .innerJoin(agentChatThread, eq(agentChatThread.id, helenaChatReflection.threadId))
    .where(eq(helenaChatReflection.agentId, agentId))
    .orderBy(desc(helenaChatReflection.id))
    .limit(limit);
  return rows.map(({ reflection, threadTitle }) => ({
    id: reflection.id,
    threadId: reflection.threadId,
    threadTitle,
    reason: reflection.reason as ChatReflectionView['reason'],
    status:
      reflection.status === 'pending' && reflection.claimedAt !== null
        ? 'running'
        : (reflection.status as ChatReflectionView['status']),
    turns: reflection.turns,
    saved: Array.isArray(reflection.saved) ? (reflection.saved as ChatReflectionView['saved']) : [],
    summary: reflection.summary,
    error: reflection.lastError,
    tokens:
      reflection.inputTokens === null && reflection.outputTokens === null
        ? null
        : (reflection.inputTokens ?? 0) + (reflection.outputTokens ?? 0),
    dueAt: reflection.nextAttemptAt.toISOString(),
    finishedAt: reflection.finishedAt?.toISOString() ?? null,
  }));
}
