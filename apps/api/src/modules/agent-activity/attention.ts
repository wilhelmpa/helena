import { agentChatMessage, agentChatThread, db } from '@repo/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export async function markChatFailuresSeen(userId: string, projectId?: number, ids?: number[]) {
  if (ids?.length === 0) return 0;
  const rows = await db
    .update(agentChatMessage)
    .set({ attentionSeenAt: new Date() })
    .where(
      and(
        eq(agentChatMessage.status, 'failed'),
        isNull(agentChatMessage.attentionSeenAt),
        ids ? inArray(agentChatMessage.id, ids) : undefined,
        inArray(
          agentChatMessage.threadId,
          db
            .select({ id: agentChatThread.id })
            .from(agentChatThread)
            .where(
              and(
                eq(agentChatThread.userId, userId),
                projectId === undefined ? undefined : eq(agentChatThread.projectId, projectId),
              ),
            ),
        ),
      ),
    )
    .returning({ id: agentChatMessage.id });
  return rows.length;
}

export const unresolvedChatFailure = sql<boolean>`
  ${agentChatMessage.status} = 'failed'
  and ${agentChatMessage.attentionSeenAt} is null
  and ${agentChatThread.deletedAt} is null
  and ${agentChatThread.archivedAt} is null
  and not exists (
    select 1 from agent_chat_message recovered
    where recovered.thread_id = ${agentChatMessage.threadId}
      and recovered.role = 'assistant' and recovered.status = 'success'
      and recovered.id > ${agentChatMessage.id}
      and recovered.finished_at >= coalesce(${agentChatMessage.finishedAt}, ${agentChatMessage.createdAt})
      and (recovered.parent_id = ${agentChatMessage.parentId} or exists (
        with recursive ancestors as (
          select id, parent_id from agent_chat_message where id = recovered.parent_id
          union
          select parent.id, parent.parent_id from agent_chat_message parent
            join ancestors child on parent.id = child.parent_id
        )
        select 1 from ancestors where id = ${agentChatMessage.id}
      ))
  )`;
