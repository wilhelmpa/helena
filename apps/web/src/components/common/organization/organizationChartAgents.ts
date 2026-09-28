import type { OrganizationAgent } from '@/lib/api/endpoints/organization';

// Keep the whole reporting chain even when a coordinator belongs to another project.
export function organizationChartAgents(
  agents: OrganizationAgent[],
  projectId?: number,
): OrganizationAgent[] {
  if (projectId == null) return agents.filter((agent) => !agent.template);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const visible = new Set<number>();
  for (const agent of agents) {
    if (!agent.projects.some((project) => project.id === projectId)) continue;
    let current: OrganizationAgent | undefined = agent;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.reportsToAgentId == null ? undefined : byId.get(current.reportsToAgentId);
    }
  }
  const home = agents.find((agent) => agent.isHome);
  if (home) visible.add(home.id);
  return agents.filter((agent) => visible.has(agent.id) && !agent.template);
}
