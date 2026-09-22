import type { Organization } from '@/lib/api/endpoints/organization';

export function organizationForProject(
  organization: Organization,
  projectKey: string,
): Organization {
  const project = organization.projects.find((candidate) => candidate.key === projectKey);
  if (!project) {
    return { ...organization, departments: [], goals: [], agents: [], projects: [] };
  }

  const goals = organization.goals.filter((goal) => goal.projectId === project.id);
  const agents = organization.agents
    .filter((agent) => agent.projects.some((candidate) => candidate.key === projectKey))
    .map((agent) => ({
      ...agent,
      projects: agent.projects.filter((candidate) => candidate.key === projectKey),
    }));

  const departmentIds = new Set<number>();
  if (project.departmentId != null) departmentIds.add(project.departmentId);
  for (const goal of goals) if (goal.departmentId != null) departmentIds.add(goal.departmentId);
  for (const agent of agents) if (agent.departmentId != null) departmentIds.add(agent.departmentId);

  const departmentsById = new Map(
    organization.departments.map((department) => [department.id, department]),
  );
  for (const departmentId of [...departmentIds]) {
    let current = departmentsById.get(departmentId);
    while (current?.parentId != null) {
      departmentIds.add(current.parentId);
      current = departmentsById.get(current.parentId);
    }
  }

  return {
    ...organization,
    departments: organization.departments.filter((department) => departmentIds.has(department.id)),
    goals,
    agents,
    projects: [project],
  };
}
