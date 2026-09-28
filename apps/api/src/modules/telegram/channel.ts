import {
  aiAgent,
  approvalRequest,
  db,
  getInstanceBotConfig,
  isInstanceBotUsable,
  project,
  projectMember,
  telegramApprovalNotice,
  telegramChannelEvent,
  userTelegramAccount,
} from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { sendMessage } from '#modules/agents/chat/service';
import { getApproval, decideApprovalRequest } from '#modules/approvals/service';
import { HttpError } from '#shared/lib';

export async function selectTelegramTarget(
  userId: string,
  agentId: number | null,
  projectKey: string | null,
) {
  if (agentId === null && projectKey) throw new HttpError(400, 'A project needs an agent');
  if (agentId !== null) {
    const [agent] = await db
      .select({
        id: aiAgent.id,
        userId: aiAgent.userId,
        ownerUserId: aiAgent.ownerUserId,
        role: aiAgent.agentRole,
        teamId: aiAgent.teamId,
      })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId));
    if (!agent) throw new HttpError(404, 'Agent not found');
    if (projectKey) {
      const [target] = await db
        .select({ id: project.id, teamId: project.teamId })
        .from(project)
        .innerJoin(projectMember, eq(projectMember.projectId, project.id))
        .where(and(eq(project.key, projectKey), eq(projectMember.userId, userId)));
      if (!target || target.teamId !== agent.teamId)
        throw new HttpError(403, 'Project is not available');
      const [agentMembership] = await db
        .select({ id: projectMember.projectId })
        .from(projectMember)
        .where(and(eq(projectMember.projectId, target.id), eq(projectMember.userId, agent.userId)));
      if (!agentMembership) throw new HttpError(403, 'Agent is not in the project');
    } else if (agent.role !== 'home' || agent.ownerUserId !== userId) {
      throw new HttpError(403, 'A project is required for this agent');
    }
  }
  const [account] = await db
    .select({ userId: userTelegramAccount.userId })
    .from(userTelegramAccount)
    .where(
      and(eq(userTelegramAccount.userId, userId), sql`${userTelegramAccount.chatId} IS NOT NULL`),
    );
  if (!account) throw new HttpError(404, 'Telegram account is not paired');
  const [target] = projectKey
    ? await db.select({ id: project.id }).from(project).where(eq(project.key, projectKey))
    : [];
  await db
    .update(userTelegramAccount)
    .set({
      selectedAgentId: agentId,
      selectedProjectId: target?.id ?? null,
      currentThreadId: null,
    })
    .where(eq(userTelegramAccount.userId, userId));
  return { agentId, projectId: target?.id ?? null };
}

async function targetFor(userId: string, tx: Tx) {
  const [account] = await tx
    .select({
      selectedAgentId: userTelegramAccount.selectedAgentId,
      selectedProjectId: userTelegramAccount.selectedProjectId,
      currentThreadId: userTelegramAccount.currentThreadId,
    })
    .from(userTelegramAccount)
    .where(eq(userTelegramAccount.userId, userId));
  if (!account) return null;
  let agentId = account.selectedAgentId;
  if (agentId === null) {
    const [home] = await tx
      .select({ id: aiAgent.id })
      .from(aiAgent)
      .where(and(eq(aiAgent.ownerUserId, userId), eq(aiAgent.agentRole, 'home')))
      .orderBy(aiAgent.id)
      .limit(1);
    agentId = home?.id ?? null;
  }
  if (agentId === null) return null;
  if (account.selectedProjectId !== null) {
    const [selectedAgent] = await tx
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId));
    if (!selectedAgent) return null;
    const members = await tx
      .select({ userId: projectMember.userId })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, account.selectedProjectId),
          inArray(projectMember.userId, [userId, selectedAgent.userId]),
        ),
      );
    if (members.length !== 2) return null;
  }
  const [agent] = await tx
    .select({
      maxConcurrentChats: aiAgent.maxConcurrentChats,
      role: aiAgent.agentRole,
      ownerUserId: aiAgent.ownerUserId,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (
    !agent ||
    (account.selectedProjectId === null && (agent.role !== 'home' || agent.ownerUserId !== userId))
  )
    return null;
  return {
    agentId,
    projectId: account.selectedProjectId,
    threadId: account.currentThreadId,
    maxConcurrentChats: agent.maxConcurrentChats,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ClaimedEvent {
  id: number;
  userId: string;
  kind: 'message' | 'decision';
  text: string | null;
  approvalId: number | null;
  approved: boolean | null;
  pairingId: string | null;
}

async function claimEvent(tx: Tx): Promise<ClaimedEvent | null> {
  const rows = await tx.execute(sql`
    UPDATE telegram_channel_event e
    SET state = 'processing', claimed_at = now()
    WHERE e.id = (
      SELECT q.id FROM telegram_channel_event q
      WHERE ((q.state = 'pending' AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 seconds'))
        OR (q.state = 'processing' AND q.claimed_at < now() - interval '2 minutes'))
        AND NOT EXISTS (
          SELECT 1 FROM telegram_channel_event busy
          WHERE busy.user_id = q.user_id AND busy.id <> q.id
            AND busy.state = 'processing' AND busy.claimed_at >= now() - interval '2 minutes'
        )
        AND NOT EXISTS (
          SELECT 1 FROM telegram_channel_event earlier
          WHERE earlier.user_id = q.user_id AND earlier.id < q.id
            AND earlier.state IN ('pending', 'processing')
        )
      ORDER BY q.id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING e.id, e.user_id AS "userId", e.kind, e.text, e.approval_id AS "approvalId", e.approved, e.pairing_id AS "pairingId"
  `);
  return (rows as unknown as ClaimedEvent[])[0] ?? null;
}

async function processEvent(
  event: ClaimedEvent,
  tx: Tx,
): Promise<{ answerMessageId?: number; responseText?: string }> {
  if (!event.pairingId) return { responseText: 'Telegram pairing is no longer valid.' };
  const [paired] = await tx
    .select({ id: userTelegramAccount.userId })
    .from(userTelegramAccount)
    .where(
      and(
        eq(userTelegramAccount.userId, event.userId),
        sql`${userTelegramAccount.chatId} IS NOT NULL`,
        sql`${userTelegramAccount.telegramUserId} IS NOT NULL`,
        eq(userTelegramAccount.pairingId, event.pairingId),
      ),
    )
    .for('update');
  if (!paired) return { responseText: 'Telegram pairing is no longer valid.' };
  if (event.kind === 'message') {
    const target = await targetFor(event.userId, tx);
    if (!target || !event.text)
      return { responseText: 'Choose an agent in Helena settings before chatting.' };
    const sent = await sendMessage(
      {
        agentId: target.agentId,
        userId: event.userId,
        projectId: target.projectId,
        prompt: event.text,
        threadId: target.threadId ?? undefined,
        maxConcurrentChats: target.maxConcurrentChats,
      },
      tx,
    );
    if (!sent)
      return {
        responseText:
          'The selected chat is unavailable. Choose the agent again in Helena settings.',
      };
    await tx
      .update(userTelegramAccount)
      .set({ currentThreadId: sent.threadId })
      .where(eq(userTelegramAccount.userId, event.userId));
    return { answerMessageId: sent.messageId };
  }
  if (!event.approvalId || event.approved === null)
    return { responseText: 'Invalid approval decision.' };
  const [agentUser] = await tx
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, event.userId));
  if (agentUser) return { responseText: 'Only a person can decide an approval.' };
  const approval = await getApproval(event.approvalId, tx);
  if (!approval) return { responseText: 'Approval no longer exists.' };
  const [owner] = await tx
    .select({ id: projectMember.userId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, approval.projectId),
        eq(projectMember.userId, event.userId),
        eq(projectMember.role, 'owner'),
      ),
    )
    .for('share');
  if (!owner) return { responseText: 'Approval is not available to this account.' };
  if (approval.kind === 'budget')
    return { responseText: 'Decide budget requests in Helena Approvals.' };
  try {
    await decideApprovalRequest(event.approvalId, event.userId, { approved: event.approved }, tx);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409)
      return { responseText: 'Approval was already decided.' };
    throw error;
  }
  return { responseText: event.approved ? 'Approved.' : 'Rejected.' };
}

export async function processTelegramEvents(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const processed = await db.transaction(async (tx) => {
      const event = await claimEvent(tx);
      if (!event) return false;
      try {
        // The queue result and its chat or approval commit together, including after a restart.
        await tx.transaction(async (work) => {
          const result = await processEvent(event, work);
          await work
            .update(telegramChannelEvent)
            .set({ state: 'done', ...result })
            .where(eq(telegramChannelEvent.id, event.id));
        });
      } catch (error) {
        const retry = error instanceof HttpError && (error.status === 409 || error.status === 429);
        await tx
          .update(telegramChannelEvent)
          .set(
            retry
              ? { state: 'pending' }
              : { state: 'done', responseText: 'Helena could not process this request.' },
          )
          .where(eq(telegramChannelEvent.id, event.id));
      }
      return true;
    });
    if (!processed) break;
  }
}

export async function enqueueTelegramApproval(
  approvalId: number,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return;
  if (!isInstanceBotUsable(await getInstanceBotConfig())) return;
  const linked = await db
    .select({ userId: userTelegramAccount.userId })
    .from(userTelegramAccount)
    .innerJoin(approvalRequest, eq(approvalRequest.id, approvalId))
    .innerJoin(
      projectMember,
      and(
        eq(projectMember.projectId, approvalRequest.projectId),
        eq(projectMember.userId, userTelegramAccount.userId),
        eq(projectMember.role, 'owner'),
      ),
    )
    .where(
      and(
        sql`${userTelegramAccount.telegramUserId} IS NOT NULL`,
        sql`${userTelegramAccount.linkedAt} IS NOT NULL`,
        sql`${approvalRequest.kind} <> 'budget'`,
        inArray(userTelegramAccount.userId, userIds),
        sql`${userTelegramAccount.chatId} IS NOT NULL`,
      ),
    );
  if (!linked.length) return;
  await db
    .insert(telegramApprovalNotice)
    .values(linked.map((row) => ({ approvalId, userId: row.userId })))
    .onConflictDoNothing();
}
