import {
  db,
  agentChatMessage,
  agentChatThread,
  agentRun,
  helenaAgentSession,
  issue,
  project,
} from '@repo/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { HttpError } from '#shared/lib';

// Which of an agent's runtime sessions a person may read, and what each one was in Helena.
// A runtime keeps every session of the agent in one place, but Helena's own rules decide who
// sees them: a run's session follows the run's project (a member sees the projects they are
// in), a chat's session belongs to the person who chatted, and a session Helena knows
// nothing of (started in a terminal) is for people who see the whole team's agents.

export interface SessionLink {
  runId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  chatThreadId: string | null;
  chatTitle: string | null;
}

export interface SessionViewer {
  userId: string;
  // The projects the person may read; undefined for someone who sees the whole team.
  projectIds: number[] | undefined;
}

interface Resolved {
  visible: boolean;
  link: SessionLink | null;
}

export async function resolveSessions(
  agentId: number,
  sessionIds: string[],
  viewer: SessionViewer,
): Promise<Map<string, Resolved>> {
  const ids = [...new Set(sessionIds)].filter(Boolean);
  const result = new Map<string, Resolved>();
  if (ids.length === 0) return result;
  const [runs, threads, answers, native] = await Promise.all([
    db
      .select({
        sessionId: agentRun.sessionId,
        runId: agentRun.id,
        projectId: agentRun.projectId,
        projectKey: project.key,
        issueSeq: issue.sequenceNumber,
        issueTitle: issue.title,
      })
      .from(agentRun)
      .innerJoin(project, eq(project.id, agentRun.projectId))
      .leftJoin(issue, eq(issue.id, agentRun.issueId))
      .where(and(eq(agentRun.agentId, agentId), inArray(agentRun.sessionId, ids)))
      .orderBy(desc(agentRun.id)),
    db
      .select({
        sessionId: agentChatThread.cliSessionId,
        threadId: agentChatThread.id,
        title: agentChatThread.title,
        userId: agentChatThread.userId,
      })
      .from(agentChatThread)
      .where(and(eq(agentChatThread.agentId, agentId), inArray(agentChatThread.cliSessionId, ids))),
    db
      .selectDistinct({
        sessionId: agentChatMessage.sessionId,
        threadId: agentChatThread.id,
        title: agentChatThread.title,
        userId: agentChatThread.userId,
      })
      .from(agentChatMessage)
      .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
      .where(and(eq(agentChatMessage.agentId, agentId), inArray(agentChatMessage.sessionId, ids))),
    db
      .select({
        id: helenaAgentSession.id,
        kind: helenaAgentSession.kind,
        projectId: helenaAgentSession.projectId,
        runId: helenaAgentSession.runId,
        threadId: helenaAgentSession.chatThreadId,
        userId: agentChatThread.userId,
        chatTitle: agentChatThread.title,
        issueTitle: issue.title,
        issueSeq: issue.sequenceNumber,
        projectKey: project.key,
      })
      .from(helenaAgentSession)
      .leftJoin(agentChatThread, eq(agentChatThread.id, helenaAgentSession.chatThreadId))
      .leftJoin(agentRun, eq(agentRun.id, helenaAgentSession.runId))
      .leftJoin(issue, eq(issue.id, agentRun.issueId))
      .leftJoin(project, eq(project.id, helenaAgentSession.projectId))
      .where(
        and(
          eq(helenaAgentSession.agentId, agentId),
          inArray(
            helenaAgentSession.id,
            ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
          ),
        ),
      ),
  ]);
  for (const id of ids) {
    const own = native.find((row) => row.id === id);
    if (own) {
      let visible = viewer.projectIds === undefined;
      if (own.kind === 'chat' || own.threadId) visible = own.userId === viewer.userId;
      else if (own.projectId !== null)
        visible = viewer.projectIds === undefined || viewer.projectIds.includes(own.projectId);
      result.set(id, {
        visible,
        link: {
          runId: own.runId,
          issueIdentifier: own.issueSeq !== null ? `${own.projectKey}-${own.issueSeq}` : null,
          issueTitle: own.issueTitle,
          chatThreadId: own.threadId,
          chatTitle: own.chatTitle,
        },
      });
      continue;
    }
    const run = runs.find((row) => row.sessionId === id);
    const chat = [...threads, ...answers].find((row) => row.sessionId === id);
    const link: SessionLink | null =
      run || chat
        ? {
            runId: run?.runId ?? null,
            issueIdentifier:
              run && run.issueSeq != null ? `${run.projectKey}-${run.issueSeq}` : null,
            issueTitle: run?.issueTitle ?? null,
            chatThreadId: chat?.threadId ?? null,
            chatTitle: chat?.title ?? null,
          }
        : null;
    const visible = chat
      ? chat.userId === viewer.userId
      : run
        ? viewer.projectIds === undefined || viewer.projectIds.includes(run.projectId)
        : viewer.projectIds === undefined;
    result.set(id, { visible, link });
  }
  return result;
}

// Refuses a session the person may not read, as if it did not exist.
export async function assertSessionVisible(
  agentId: number,
  sessionId: string,
  viewer: SessionViewer,
): Promise<void> {
  const resolved = (await resolveSessions(agentId, [sessionId], viewer)).get(sessionId);
  if (!resolved?.visible) throw new HttpError(404, 'Session not found');
}
