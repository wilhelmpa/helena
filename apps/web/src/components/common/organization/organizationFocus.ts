import type { Organization, OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationChartAgents } from './organizationChartAgents';

// The level the org chart shows: everything of the page (Home: all projects; a project
// page: that project), a department, a project, or a single agent in the middle.
export type OrganizationFocus =
  | { kind: 'root' }
  | { kind: 'department'; id: number }
  | { kind: 'project'; id: number }
  | { kind: 'agent'; id: number };

export interface OrganizationCrumb {
  focus: OrganizationFocus;
  label: string;
}

// The focus as it is kept in the address (?orgFocus=d3, p5, a12); null for the root.
export function focusParam(focus: OrganizationFocus): string | null {
  if (focus.kind === 'root') return null;
  return `${focus.kind[0]}${focus.id}`;
}

// Reads ?orgFocus back, falling back to the root when it names nothing that exists or
// nothing the page may show (a project page shows only its own agents).
export function focusFromParam(
  value: string | null,
  organization: Organization,
  projectId?: number,
): OrganizationFocus {
  const match = /^([dpa])(\d+)$/.exec(value ?? '');
  if (!match) return { kind: 'root' };
  const id = Number(match[2]);
  if (match[1] === 'a') {
    const allowed = organizationChartAgents(organization.agents, projectId);
    return allowed.some((agent) => agent.id === id) ? { kind: 'agent', id } : { kind: 'root' };
  }
  if (projectId != null) return { kind: 'root' };
  if (match[1] === 'd')
    return organization.departments.some((department) => department.id === id)
      ? { kind: 'department', id }
      : { kind: 'root' };
  return organization.projects.some((project) => project.id === id)
    ? { kind: 'project', id }
    : { kind: 'root' };
}

function departmentChain(organization: Organization, id: number | null) {
  const byId = new Map(organization.departments.map((department) => [department.id, department]));
  const chain = [];
  const seen = new Set<number>();
  let current = id == null ? undefined : byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return chain;
}

// The agents a level shows, and the breadcrumb back to the page's root.
export function focusScope(
  organization: Organization,
  focus: OrganizationFocus,
  projectId?: number,
): { agents: OrganizationAgent[]; crumbs: OrganizationCrumb[] } {
  const pageProject = organization.projects.find((project) => project.id === projectId);
  const root: OrganizationCrumb = { focus: { kind: 'root' }, label: pageProject?.name ?? '' };
  const pageAgents = organizationChartAgents(organization.agents, projectId);
  const projectCrumbs = (id: number | undefined): OrganizationCrumb[] => {
    const project = organization.projects.find((item) => item.id === id);
    if (!project || projectId != null) return [];
    return [
      ...departmentChain(organization, project.departmentId).map((department) => ({
        focus: { kind: 'department' as const, id: department.id },
        label: department.name,
      })),
      { focus: { kind: 'project', id: project.id }, label: project.name },
    ];
  };

  if (focus.kind === 'department') {
    const departments = new Set(
      organization.departments
        .filter((department) =>
          departmentChain(organization, department.id).some((item) => item.id === focus.id),
        )
        .map((department) => department.id),
    );
    const projects = organization.projects.filter(
      (project) => project.departmentId != null && departments.has(project.departmentId),
    );
    const ids = new Set<number>();
    for (const project of projects)
      for (const agent of organizationChartAgents(organization.agents, project.id))
        ids.add(agent.id);
    return {
      agents: pageAgents.filter((agent) => ids.has(agent.id)),
      crumbs: [
        root,
        ...departmentChain(organization, focus.id).map((department) => ({
          focus: { kind: 'department' as const, id: department.id },
          label: department.name,
        })),
      ],
    };
  }
  if (focus.kind === 'project') {
    return {
      agents: organizationChartAgents(organization.agents, focus.id),
      crumbs: [root, ...projectCrumbs(focus.id)],
    };
  }
  if (focus.kind === 'agent') {
    const agent = pageAgents.find((item) => item.id === focus.id);
    if (!agent) return { agents: pageAgents, crumbs: [root] };
    const byManager = new Map<number, OrganizationAgent[]>();
    for (const item of pageAgents)
      if (item.reportsToAgentId != null)
        byManager.set(item.reportsToAgentId, [
          ...(byManager.get(item.reportsToAgentId) ?? []),
          item,
        ]);
    const ids = new Set<number>([agent.id]);
    const queue = [agent.id];
    while (queue.length) {
      for (const report of byManager.get(queue.shift()!) ?? []) {
        if (ids.has(report.id)) continue;
        ids.add(report.id);
        queue.push(report.id);
      }
    }
    if (agent.reportsToAgentId != null) ids.add(agent.reportsToAgentId);
    const homeProject = agent.isHome
      ? undefined
      : (agent.projects.find((item) => item.id === projectId) ?? agent.projects[0]);
    return {
      agents: pageAgents.filter((item) => ids.has(item.id)),
      crumbs: [
        root,
        ...projectCrumbs(homeProject?.id),
        { focus: { kind: 'agent', id: agent.id }, label: agent.name },
      ],
    };
  }
  return { agents: pageAgents, crumbs: [root] };
}
