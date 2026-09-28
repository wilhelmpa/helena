import { and, asc, eq, sql } from 'drizzle-orm';
import { agentRun, db, helenaAgentSession, helenaAgentSessionItem, project } from '@repo/db';
import { agentSessionSource, reindexItems } from '@helena/knowledge';
import { HttpError } from '#shared/lib';
import type { RunnerAgent } from '../runner/service';

// The sessions of Helena's own agent loop (docs/helena-decisions/zentrale-laufzeit.md §7):
// created, read and appended by the agent's own command with its key, one message per item.
// A command started again after the runner restarted loads the session and goes on.

export const SESSION_ITEM_LIMIT = 200;
const ITEM_BYTES = 512 * 1024;

export async function createSession(
  agent: RunnerAgent,
  input: {
    kind: 'run' | 'chat' | 'reflection';
    model: string | null;
    runId: number | null;
    threadId: string | null;
  },
): Promise<{ id: string }> {
  let projectId: number | null = null;
  let runId: number | null = null;
  if (input.runId !== null) {
    const [run] = await db
      .select({ projectId: agentRun.projectId, agentId: agentRun.agentId })
      .from(agentRun)
      .where(eq(agentRun.id, input.runId));
    // A run of another agent is not this session's.
    if (run?.agentId === agent.id) {
      projectId = run.projectId;
      runId = input.runId;
    }
  }
  if (projectId === null && agent.projects.length === 1 && agent.agentRole !== 'home') {
    projectId = await projectIdOf(agent.projects[0]!.key, agent.teamId);
  }
  const [row] = await db
    .insert(helenaAgentSession)
    .values({
      agentId: agent.id,
      teamId: agent.teamId,
      projectId,
      kind: input.kind,
      runId,
      chatThreadId: input.threadId?.slice(0, 200) ?? null,
      model: input.model?.slice(0, 200) ?? null,
    })
    .returning({ id: helenaAgentSession.id });
  return { id: row!.id };
}

async function projectIdOf(key: string, teamId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.key, key), eq(project.teamId, teamId)));
  return row?.id ?? null;
}

async function ownSession(agent: RunnerAgent, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Session not found');
  const [session] = await db
    .select()
    .from(helenaAgentSession)
    .where(and(eq(helenaAgentSession.id, id), eq(helenaAgentSession.agentId, agent.id)));
  if (!session) throw new HttpError(404, 'Session not found');
  return session;
}

export async function loadSession(agent: RunnerAgent, id: string) {
  const session = await ownSession(agent, id);
  const items = await db
    .select({
      seq: helenaAgentSessionItem.seq,
      step: helenaAgentSessionItem.step,
      content: helenaAgentSessionItem.content,
    })
    .from(helenaAgentSessionItem)
    .where(eq(helenaAgentSessionItem.sessionId, session.id))
    .orderBy(asc(helenaAgentSessionItem.seq));
  return {
    id: session.id,
    summary: session.summary,
    compactedThrough: session.compactedThrough,
    items: items.map((item) => ({ seq: item.seq, step: item.step, message: item.content })),
  };
}

function reindexLater(id: string): void {
  void reindexItems(agentSessionSource, [id]).catch((error: unknown) => {
    console.error('[helena-runtime] session reindex failed', error);
  });
}

export async function appendItems(
  agent: RunnerAgent,
  id: string,
  items: { seq: number; step: number; message: unknown; text: string }[],
): Promise<void> {
  const session = await ownSession(agent, id);
  if (items.length > SESSION_ITEM_LIMIT) throw new HttpError(400, 'Too many items at once');
  const rows = items.map((item) => {
    const message = item.message as { role?: unknown };
    const role = typeof message?.role === 'string' ? message.role : '';
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      throw new HttpError(400, 'An item is not a model message');
    }
    if (JSON.stringify(item.message).length > ITEM_BYTES) {
      throw new HttpError(400, 'An item is too large');
    }
    return {
      sessionId: session.id,
      seq: item.seq,
      step: item.step,
      role,
      content: item.message,
      text: item.text.slice(0, 20_000),
    };
  });
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.insert(helenaAgentSessionItem).values(rows).onConflictDoNothing();
    await tx
      .update(helenaAgentSession)
      .set({ updatedAt: new Date() })
      .where(eq(helenaAgentSession.id, session.id));
  });
  reindexLater(session.id);
}

export async function compactSession(
  agent: RunnerAgent,
  id: string,
  summary: string,
  compactedThrough: number,
): Promise<void> {
  const session = await ownSession(agent, id);
  // The summary may only move forward: a late retry of an older compaction changes nothing.
  await db
    .update(helenaAgentSession)
    .set({ summary: summary.slice(0, 40_000), compactedThrough, updatedAt: new Date() })
    .where(
      and(
        eq(helenaAgentSession.id, session.id),
        sql`${helenaAgentSession.compactedThrough} <= ${compactedThrough}`,
      ),
    );
  reindexLater(session.id);
}
