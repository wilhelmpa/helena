import { HttpError } from '#shared/lib';
import type { TeamMembership } from '#shared/access';
import { runsTeam } from '#modules/teams/service';
import { agentScopeOf, getAgentById, memberProjectIds, type AiAgentRow } from './core/service';

// What an agent did and holds (its runs, sessions, transcripts, memory, logs) is shown to
// people only, never to another agent, whatever its role grants. A person who does not run the
// team sees an agent they share a project with, and only what happened in those projects.
export async function agentForPerson(
  agentId: number,
  membership: TeamMembership,
): Promise<{ agent: AiAgentRow; projectIds: number[] | undefined }> {
  if (membership.role === 'agent') {
    throw new HttpError(403, 'Only a person can read what an agent did');
  }
  const agent = await getAgentById(agentId, membership.teamId, agentScopeOf(membership));
  if (!agent) throw new HttpError(404, 'Agent not found');
  const projectIds = runsTeam(membership.role)
    ? undefined
    : await memberProjectIds(membership.teamId, membership.userId);
  return { agent, projectIds };
}
