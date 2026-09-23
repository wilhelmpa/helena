import type {
  AgentTeamRole,
  Organization,
  OrganizationAgent,
  OrganizationDepartment,
  OrganizationGoal,
} from '@/lib/api/endpoints/organization';

export interface OrganizationAgentNode {
  agent: OrganizationAgent;
  reports: OrganizationAgentNode[];
}

// 'department': a real organization_department. The other three are synthetic roots
// that group agents.departmentId === null agents by why they have no department, so a
// normal (if unsorted) agent is never rendered next to a genuine orphan.
export type OrganizationDepartmentNodeKind = 'department' | 'none' | 'templates' | 'unassigned';

export interface OrganizationDepartmentNode {
  department: OrganizationDepartment | null;
  kind: OrganizationDepartmentNodeKind;
  agents: OrganizationAgentNode[];
  goals: OrganizationGoalNode[];
  children: OrganizationDepartmentNode[];
}

export interface OrganizationGoalNode {
  goal: OrganizationGoal;
  children: OrganizationGoalNode[];
}

export type OrganizationAgentRole = AgentTeamRole | 'pool';

export function organizationAgentRole(agent: OrganizationAgent): OrganizationAgentRole {
  return agent.role ?? 'pool';
}

// Whether an agent has a place in the organization, independent of its department:
// - 'home': the root of the reporting chain (master). Never unassigned.
// - 'template': a pool template. Runs nowhere and joins no project by design, so it is
//   never "unassigned" either, it is shown as a template.
// - 'assigned': reports to another agent (Home -> Coordinator -> Specialist chain).
// - 'unassigned': none of the above — a real orphan that needs a manager or a role.
export type OrganizationAgentStatus = 'home' | 'template' | 'assigned' | 'unassigned';

export function organizationAgentStatus(agent: OrganizationAgent): OrganizationAgentStatus {
  if (agent.isHome) return 'home';
  if (agent.template) return 'template';
  if (agent.reportsToAgentId != null) return 'assigned';
  return 'unassigned';
}

function goalTree(goals: OrganizationGoal[]): OrganizationGoalNode[] {
  const nodes = new Map<number, OrganizationGoalNode>(
    goals.map((goal) => [goal.id, { goal, children: [] }]),
  );
  const roots: OrganizationGoalNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.goal.parentGoalId == null ? undefined : nodes.get(node.goal.parentGoalId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function agentTree(agents: OrganizationAgent[]): OrganizationAgentNode[] {
  const nodes = new Map<number, OrganizationAgentNode>(
    agents.map((agent) => [agent.id, { agent, reports: [] }]),
  );
  const roots: OrganizationAgentNode[] = [];
  for (const node of nodes.values()) {
    const manager =
      node.agent.reportsToAgentId == null ? undefined : nodes.get(node.agent.reportsToAgentId);
    if (manager) manager.reports.push(node);
    else roots.push(node);
  }
  const sort = (items: OrganizationAgentNode[]) => {
    items.sort((a, b) => a.agent.name.localeCompare(b.agent.name));
    for (const item of items) sort(item.reports);
  };
  sort(roots);
  return roots;
}

export function buildOrganizationTree(organization: Organization): OrganizationDepartmentNode[] {
  const nodes = new Map<number, OrganizationDepartmentNode>();
  for (const department of organization.departments) {
    nodes.set(department.id, {
      department,
      kind: 'department',
      agents: [],
      goals: [],
      children: [],
    });
  }
  const roots: OrganizationDepartmentNode[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.department?.parentId == null ? undefined : nodes.get(node.department.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of nodes.values()) {
    node.agents = agentTree(
      organization.agents.filter((agent) => agent.departmentId === node.department?.id),
    );
    node.goals = goalTree(
      organization.goals.filter((goal) => goal.departmentId === node.department?.id),
    );
  }
  const withoutDepartment = organization.agents.filter((agent) => agent.departmentId == null);
  const withoutDepartmentGoals = organization.goals.filter((goal) => goal.departmentId == null);
  // Split by *why* they have no department, so the Home master and every agent that
  // reports to someone (the normal case today: departments are assigned to projects,
  // rarely to individual agents) never land in the same bucket as a real orphan or a
  // pool template.
  const templates = withoutDepartment.filter(
    (agent) => organizationAgentStatus(agent) === 'template',
  );
  const unassigned = withoutDepartment.filter(
    (agent) => organizationAgentStatus(agent) === 'unassigned',
  );
  const rest = withoutDepartment.filter((agent) => {
    const status = organizationAgentStatus(agent);
    return status === 'home' || status === 'assigned';
  });
  if (rest.length > 0 || withoutDepartmentGoals.length > 0) {
    roots.push({
      department: null,
      kind: 'none',
      agents: agentTree(rest),
      goals: goalTree(withoutDepartmentGoals),
      children: [],
    });
  }
  if (templates.length > 0) {
    roots.push({
      department: null,
      kind: 'templates',
      agents: agentTree(templates),
      goals: [],
      children: [],
    });
  }
  if (unassigned.length > 0) {
    roots.push({
      department: null,
      kind: 'unassigned',
      agents: agentTree(unassigned),
      goals: [],
      children: [],
    });
  }
  const sortDepartments = (items: OrganizationDepartmentNode[]) => {
    items.sort(
      (a, b) =>
        (a.department?.position ?? Number.MAX_SAFE_INTEGER) -
          (b.department?.position ?? Number.MAX_SAFE_INTEGER) ||
        (a.department?.name ?? '').localeCompare(b.department?.name ?? ''),
    );
    for (const item of items) sortDepartments(item.children);
  };
  sortDepartments(roots);
  return roots;
}
