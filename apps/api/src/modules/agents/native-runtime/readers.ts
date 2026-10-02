import { aiAgent, db, agentChatThread, helenaAgentSession, helenaAgentSessionItem } from '@repo/db';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type {
  RuntimeRequest,
  SessionSummary,
  TranscriptMessage,
  TranscriptPart,
} from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { maskForTeam } from '../credentials/env';
import type { SessionViewer } from '../runtime-views/session-access';
import { nativeCurator, nativeSkillAction } from './skills';

export const NATIVE_READ_OPS = [
  'version.read',
  'sessions.list',
  'sessions.search',
  'sessions.transcript',
  'curator.status',
  'curator.run',
  'curator.set',
] as const;

function parts(message: unknown): TranscriptPart[] {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return [{ type: 'text', content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): TranscriptPart[] => {
    if (part.type === 'text' || part.type === 'reasoning')
      return [{ type: part.type, content: String(part.text ?? '') }];
    if (part.type === 'tool-call')
      return [
        {
          type: 'tool_call',
          id: part.toolCallId ?? null,
          name: part.toolName,
          arguments: part.input,
        },
      ];
    if (part.type === 'tool-result')
      return [
        {
          type: 'tool_call_response',
          id: part.toolCallId ?? null,
          name: part.toolName ?? null,
          response: part.output,
          isError: String(part.output?.type).startsWith('error'),
        },
      ];
    return [];
  });
}

async function summary(session: typeof helenaAgentSession.$inferSelect): Promise<SessionSummary> {
  const [counts] = await db
    .select({
      count: sql<number>`count(*)::int`,
      calls: sql<number>`coalesce(sum(jsonb_array_length(jsonb_path_query_array(${helenaAgentSessionItem.content}, '$.content[*] ? (@.type == "tool-call")'))), 0)::int`,
    })
    .from(helenaAgentSessionItem)
    .where(eq(helenaAgentSessionItem.sessionId, session.id));
  const [first] = await db
    .select({ text: helenaAgentSessionItem.text })
    .from(helenaAgentSessionItem)
    .where(
      and(
        eq(helenaAgentSessionItem.sessionId, session.id),
        eq(helenaAgentSessionItem.role, 'user'),
      ),
    )
    .orderBy(asc(helenaAgentSessionItem.seq))
    .limit(1);
  return {
    id: session.id,
    title: first?.text.slice(0, 120) ?? null,
    preview: first?.text.slice(0, 300) ?? null,
    source: 'volition',
    model: session.model,
    startedAt: session.createdAt.getTime(),
    endedAt: null,
    lastActiveAt: session.updatedAt.getTime(),
    endReason: null,
    messageCount: counts?.count ?? 0,
    toolCallCount: counts?.calls ?? 0,
    estimatedCostUsd: null,
    parentSessionId: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  };
}

export async function readNativeRuntime(
  agentId: number,
  request: RuntimeRequest,
  viewer?: SessionViewer,
): Promise<unknown> {
  const [agent] = await db
    .select({ teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) throw new HttpError(404, 'Agent not found');
  const visible = viewer
    ? or(
        sql`exists (select 1 from ${agentChatThread} where ${agentChatThread.id} = ${helenaAgentSession.chatThreadId} and ${agentChatThread.userId} = ${viewer.userId})`,
        and(
          isNull(helenaAgentSession.chatThreadId),
          ne(helenaAgentSession.kind, 'chat'),
          viewer.projectIds === undefined
            ? sql`true`
            : inArray(helenaAgentSession.projectId, viewer.projectIds),
        ),
      )
    : undefined;
  let result: unknown;
  if (request.op === 'version.read') {
    const { version } = await import('../../../../../../packages/agent-runtime/package.json');
    result = { runtime: 'helena', version, detail: null };
  } else if (request.op === 'curator.status' || request.op === 'curator.run') {
    result = await nativeCurator(agentId, request.op === 'curator.run');
  } else if (request.op === 'curator.set') {
    await nativeSkillAction(agentId, request.skill, request.action === 'pin');
    result = await nativeCurator(agentId, false);
  } else if (request.op === 'sessions.list') {
    const where = and(eq(helenaAgentSession.agentId, agentId), visible);
    const rows = await db
      .select()
      .from(helenaAgentSession)
      .where(where)
      .orderBy(desc(helenaAgentSession.updatedAt), desc(helenaAgentSession.id))
      .limit(Math.min(request.limit ?? 25, 100))
      .offset(request.offset ?? 0);
    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(helenaAgentSession)
      .where(where);
    result = { sessions: await Promise.all(rows.map(summary)), total: count?.total ?? 0 };
  } else if (request.op === 'sessions.search') {
    const query = request.query.replace(/[\\%_]/g, '\\$&');
    const rows = await db
      .select({ session: helenaAgentSession, item: helenaAgentSessionItem })
      .from(helenaAgentSession)
      .innerJoin(
        helenaAgentSessionItem,
        eq(helenaAgentSession.id, helenaAgentSessionItem.sessionId),
      )
      .where(
        and(
          eq(helenaAgentSession.agentId, agentId),
          ilike(helenaAgentSessionItem.text, `%${query}%`),
          visible,
        ),
      )
      .orderBy(desc(helenaAgentSession.updatedAt), asc(helenaAgentSessionItem.seq))
      .limit(Math.min(request.limit ?? 20, 100));
    result = await Promise.all(
      rows.map(async (row) => ({
        sessionId: row.session.id,
        role: row.item.role,
        snippet: row.item.text.slice(0, 500),
        session: await summary(row.session),
      })),
    );
  } else if (request.op === 'sessions.transcript') {
    if (!/^[0-9a-f-]{36}$/i.test(request.sessionId)) throw new HttpError(404, 'Session not found');
    const [session] = await db
      .select()
      .from(helenaAgentSession)
      .where(
        and(eq(helenaAgentSession.agentId, agentId), eq(helenaAgentSession.id, request.sessionId)),
      );
    if (!session) throw new HttpError(404, 'Session not found');
    const offset = request.offset ?? 0;
    const rows = await db
      .select()
      .from(helenaAgentSessionItem)
      .where(eq(helenaAgentSessionItem.sessionId, session.id))
      .orderBy(asc(helenaAgentSessionItem.seq))
      .limit(Math.min(request.limit ?? 100, 500))
      .offset(offset);
    const sessionSummary = await summary(session);
    const messages: TranscriptMessage[] = [];
    let bytes = 0;
    for (const row of rows) {
      const message: TranscriptMessage = {
        id: String(row.seq),
        role: row.role as TranscriptMessage['role'],
        parts: parts(row.content),
        timestamp: row.createdAt.getTime(),
        model: session.model,
      };
      bytes += Buffer.byteLength(JSON.stringify(message));
      if (bytes > 5 * 1024 * 1024) break;
      messages.push(message);
    }
    result = {
      session: sessionSummary,
      messages,
      offset,
      totalMessages: sessionSummary.messageCount,
      truncated: messages.length < rows.length,
    };
  } else throw new HttpError(400, 'Unsupported native reader operation');
  return maskForTeam(agent.teamId, result);
}
