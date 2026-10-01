import { HttpError } from '#shared/lib';
import type { TeamMembership } from '#shared/access';
import { agentMayInspect } from '#shared/agent-access';
import { runsTeam } from '#modules/teams/service';
import { agentScopeOf, getAgentById, memberProjectIds, type AiAgentRow } from './core/service';

// Home, all-project agents and owner delegates may inspect agents in their own team.
// Other people retain the existing project-scoped view; ordinary agents cannot inspect runs.
export async function agentForPerson(
  agentId: number,
  membership: TeamMembership,
): Promise<{ agent: AiAgentRow; projectIds: number[] | undefined }> {
  const inspector =
    membership.role === 'agent' && (await agentMayInspect(membership.userId, membership.teamId));
  if (membership.role === 'agent' && !inspector) {
    throw new HttpError(403, 'Only a person can read what an agent did');
  }
  const agent = await getAgentById(
    agentId,
    membership.teamId,
    inspector ? undefined : agentScopeOf(membership),
  );
  if (!agent) throw new HttpError(404, 'Agent not found');
  const projectIds =
    runsTeam(membership.role) || inspector
      ? undefined
      : await memberProjectIds(membership.teamId, membership.userId);
  return { agent, projectIds };
}
