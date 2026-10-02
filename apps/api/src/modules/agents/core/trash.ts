import { aiAgent, apikey, db, user } from '@repo/db';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { iso } from '#shared/lib';
import { transferDepartingAssignee } from '#modules/issues/responsibility';
import { requeueProjectProvisioning } from '#modules/projects/provisioning-queue';
import { agentVisibility, getAgentById, type AgentScope } from './service';

export async function listAgentTrash(teamId: number, scope?: AgentScope) {
  const rows = await db
    .select({ id: aiAgent.id, name: user.name, deletedAt: aiAgent.deletedAt })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(eq(aiAgent.teamId, teamId), isNotNull(aiAgent.deletedAt), agentVisibility(scope, true)),
    )
    .orderBy(desc(aiAgent.deletedAt));
  return rows.map((row) => ({ id: row.id, name: row.name, deletedAt: iso(row.deletedAt!) }));
}

export async function setAgentTrashed(
  id: number,
  teamId: number,
  trashed: boolean,
  scope?: AgentScope,
) {
  const agent = await getAgentById(id, teamId, scope, true);
  if (!agent) return false;
  const rows = await db
    .update(aiAgent)
    .set({ deletedAt: trashed ? new Date() : null })
    .where(
      and(
        eq(aiAgent.id, id),
        eq(aiAgent.teamId, teamId),
        trashed ? isNull(aiAgent.deletedAt) : isNotNull(aiAgent.deletedAt),
      ),
    )
    .returning({ id: aiAgent.id });
  if (!rows.length) return false;
  await requeueProjectProvisioning(agent.projects.map((p) => p.id));
  return true;
}

export async function permanentlyDeleteTrashedAgent(
  id: number,
  teamId: number,
  scope?: AgentScope,
) {
  const agent = await getAgentById(id, teamId, scope, true);
  if (!agent) return false;
  return db.transaction(async (tx) => {
    const [trashed] = await tx
      .select({ userId: aiAgent.userId })
      .from(user)
      .innerJoin(aiAgent, eq(aiAgent.userId, user.id))
      .where(and(eq(aiAgent.id, id), eq(aiAgent.teamId, teamId), isNotNull(aiAgent.deletedAt)))
      .for('update');
    if (!trashed) return false;
    await tx.delete(apikey).where(eq(apikey.referenceId, trashed.userId));
    await transferDepartingAssignee(tx, trashed.userId);
    await tx.delete(user).where(eq(user.id, trashed.userId));
    await requeueProjectProvisioning(
      agent.projects.map((p) => p.id),
      tx,
    );
    return true;
  });
}
