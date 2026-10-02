import { aiAgent, db, user } from '@repo/db';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { iso } from '#shared/lib';
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
