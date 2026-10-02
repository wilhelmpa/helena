import { and, eq, isNull, ne } from 'drizzle-orm';
import { agentChatMessage, agentChatThread, aiAgent, db, projectMember } from '@repo/db';
import { normalizeRuntimePolicy } from '../core/service';
import type { EscalationReport } from '../runner/escalation';

export async function queueChatEscalation(
  agentId: number,
  messageId: number,
  report: EscalationReport,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(agentChatMessage)
      .where(
        and(
          eq(agentChatMessage.id, messageId),
          eq(agentChatMessage.agentId, agentId),
          eq(agentChatMessage.status, 'success'),
        ),
      )
      .for('update');
    if (!source) return;
    const [thread] = await tx
      .select()
      .from(agentChatThread)
      .where(eq(agentChatThread.id, source.threadId))
      .for('update');
    if (!thread || thread.activeMessageId !== source.id) return;
    const [sender] = await tx.select().from(aiAgent).where(eq(aiAgent.id, agentId));
    if (!sender || normalizeRuntimePolicy(sender.runtimePolicy).runtime !== 'helena') return;
    const match = /^runtime:(claude|codex)(?:\/(.+))?$/.exec(report.target);
    const candidates = await tx
      .select()
      .from(aiAgent)
      .where(
        and(
          eq(aiAgent.teamId, sender.teamId),
          ne(aiAgent.id, agentId),
          eq(aiAgent.template, false),
          isNull(aiAgent.pausedAt),
        ),
      )
      .orderBy(aiAgent.id);
    let target: typeof sender | undefined;
    for (const candidate of candidates) {
      if (!match || normalizeRuntimePolicy(candidate.runtimePolicy).runtime !== match[1]) continue;
      if (thread.projectId === null && candidate.projectScope !== 'all') continue;
      if (thread.projectId !== null) {
        const [member] = await tx
          .select({ id: projectMember.userId })
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, thread.projectId),
              eq(projectMember.userId, candidate.userId),
            ),
          );
        if (!member) continue;
      }
      target = candidate;
      break;
    }
    if (!target) {
      const notice = `Zeitgrenze/Eskalation nicht möglich: Kein verfügbarer Agent für ${report.target}.`;
      if (source.content.endsWith(notice)) return;
      await tx
        .update(agentChatMessage)
        .set({
          status: 'success',
          lastError: null,
          content: `${source.content}\n\n${notice}`,
        })
        .where(eq(agentChatMessage.id, messageId));
      return;
    }
    const [handover] = await tx
      .insert(agentChatMessage)
      .values({
        threadId: thread.id,
        agentId: target.id,
        parentId: source.id,
        role: 'user',
        status: 'success',
        content: `Handover to ${report.target} (${report.reason}).\n\n${report.handover}`,
      })
      .returning({ id: agentChatMessage.id });
    const [answer] = await tx
      .insert(agentChatMessage)
      .values({
        threadId: thread.id,
        agentId: target.id,
        parentId: handover!.id,
        role: 'assistant',
        model: match?.[2] ?? null,
      })
      .returning({ id: agentChatMessage.id });
    await tx
      .update(agentChatThread)
      .set({ activeMessageId: answer!.id, updatedAt: new Date() })
      .where(eq(agentChatThread.id, thread.id));
  });
}
