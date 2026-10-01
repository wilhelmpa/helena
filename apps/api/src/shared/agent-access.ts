import { aiAgent, db, organizationAgentAssignment, projectMember, project } from '@repo/db';
import { and, eq } from 'drizzle-orm';

// Team boundary and project membership remain authoritative for delegated access.
export async function agentAccess(userId: string, teamId?: number) {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      role: aiAgent.agentRole,
      scope: aiAgent.projectScope,
      modelRole: aiAgent.modelRole,
      template: aiAgent.template,
      coordinator: organizationAgentAssignment.role,
    })
    .from(aiAgent)
    .leftJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .where(
      and(
        eq(aiAgent.userId, userId),
        ...(teamId === undefined ? [] : [eq(aiAgent.teamId, teamId)]),
      ),
    )
    .limit(1);
  return agent ?? null;
}

export async function agentMayInspect(userId: string, teamId: number): Promise<boolean> {
  const agent = await agentAccess(userId, teamId);
  if (!agent) return false;
  if (agent.role === 'home' || agent.scope === 'all') return true;
  const [owned] = await db
    .select({ id: project.id })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(project.teamId, teamId),
        eq(projectMember.userId, userId),
        eq(projectMember.role, 'owner'),
      ),
    )
    .limit(1);
  return !!owned;
}

export async function agentCoordinatesProject(userId: string, projectId: number): Promise<boolean> {
  const agent = await agentAccess(userId);
  if (!agent || agent.coordinator !== 'coordinator') return false;
  const [member] = await db
    .select({ id: project.id })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
        eq(project.teamId, agent.teamId),
      ),
    )
    .limit(1);
  return !!member;
}

export async function agentMayReadDecisionClasses(
  userId: string,
  teamId: number,
): Promise<boolean> {
  const agent = await agentAccess(userId, teamId);
  return !!agent && (agent.role === 'home' || agent.coordinator === 'coordinator');
}
