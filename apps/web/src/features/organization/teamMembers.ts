import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { Organization } from '@/lib/api/endpoints/organization';

export type MemberSource = 'pool' | 'template';

export interface MemberOption {
  id: number;
  name: string;
  // Where it works now (pool) — the project keys.
  detail: string;
  meta: string;
}

export interface MemberCandidates {
  options: MemberOption[];
  // Whom the new member may report to: the project's agents and Helena.
  managers: { id: number; name: string }[];
  // The project's coordinator, else Helena.
  defaultManagerId: number | null;
}

// What "Mitglied hinzufügen" offers for a project (AddTeamMemberDialog): from the pool
// every agent that does not work in it yet (never a template, never Helena, who works
// everywhere), or every template, whose copy becomes a new agent of the project; and the
// agents the new member can report to.
export function teamMemberCandidates(
  organization: Organization,
  agents: AiAgent[],
  projectId: number | null,
  source: MemberSource,
): MemberCandidates {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const inProject = (projects: { id: number }[]) =>
    projectId != null && projects.some((project) => project.id === projectId);
  const home = organization.agents.find((agent) => agent.isHome) ?? null;
  const options =
    projectId == null
      ? []
      : source === 'pool'
        ? agents
            .filter(
              (agent) => !agent.template && agent.id !== home?.id && !inProject(agent.projects),
            )
            .sort(byName)
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              detail: agent.projects.map((project) => project.key).join(' · '),
              meta: '',
            }))
        : agents
            // A template already copied into the project is not offered again: the second
            // copy would take the first one's name.
            .filter(
              (agent) =>
                agent.template &&
                !agents.some(
                  (copy) => copy.sourceTemplateId === agent.id && inProject(copy.projects),
                ),
            )
            .sort(byName)
            .map((agent) => ({ id: agent.id, name: agent.name, detail: '', meta: '' }));
  const projectAgents = organization.agents.filter(
    (agent) => !agent.template && !agent.isHome && inProject(agent.projects),
  );
  const coordinator = projectAgents.find((agent) => agent.role === 'coordinator') ?? null;
  const managers = [
    ...(coordinator ? [coordinator] : []),
    ...(home ? [home] : []),
    ...projectAgents.filter((agent) => agent.id !== coordinator?.id).sort(byName),
  ].map((agent) => ({ id: agent.id, name: agent.name }));
  return {
    options,
    managers: projectId == null ? [] : managers,
    defaultManagerId: projectId == null ? null : (coordinator?.id ?? home?.id ?? null),
  };
}
