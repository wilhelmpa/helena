import { aiAgent, agentChatMessage, agentChatThread, db } from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { DecideRequest } from './service';

// Resolve only the server-owned message identity; prompt text never supplies this scope.
export async function firstStageChatState(
  request: Pick<DecideRequest, 'teamId' | 'projectId' | 'agentId' | 'chatMessageId'>,
): Promise<{ mode: 'inherit' | 'on' | 'off'; revision: number | null } | null> {
  if (request.chatMessageId == null) return { mode: 'inherit', revision: null };
  if (request.agentId == null) return null;
  const [row] = await db
    .select({
      mode: agentChatThread.jevFirstStage,
      revision: agentChatThread.jevFirstStageRevision,
    })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatMessage.agentId))
    .where(
      and(
        eq(agentChatMessage.id, request.chatMessageId!),
        eq(agentChatMessage.agentId, request.agentId!),
        eq(agentChatMessage.role, 'assistant'),
        eq(aiAgent.teamId, request.teamId),
        request.projectId == null
          ? isNull(agentChatThread.projectId)
          : eq(agentChatThread.projectId, request.projectId),
        isNull(agentChatThread.deletedAt),
      ),
    );
  return row ?? null;
}

export async function firstStageChatGuard(request: DecideRequest): Promise<() => Promise<boolean>> {
  const initial = await firstStageChatState(request);
  if (!initial || !['inherit', 'on'].includes(initial.mode)) return async () => false;
  return async () => {
    const current = await firstStageChatState(request);
    // A quick off/on still revokes the old attempt, including in another API process.
    return (
      current != null &&
      ['inherit', 'on'].includes(current.mode) &&
      current.revision === initial.revision
    );
  };
}
