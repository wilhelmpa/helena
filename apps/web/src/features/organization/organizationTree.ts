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
  // Only on the Home master: the departments under it, each with the agents working
  // there (a coordinator of a department's project and its specialists).
  departments?: OrganizationDepartmentNode[];
}

// 'home': the Home master as the root of the chart, with the departments and its direct
// reports under it. 'department': a real organization_department. The other three are
// synthetic roots for agents outside the Home chain, grouped by why, so a normal (if
// unsorted) agent is never rendered next to a genuine orphan.
export type OrganizationDepartmentNodeKind =
  'home' | 'department' | 'none' | 'templates' | 'unassigned';

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

// The department an agent works in: its own, else the one department all its projects
// belong to (departments are usually set on projects, rarely on agents). The Home master
// works in every project, so it has none and stays the root above the departments.
export function agentDepartmentId(
  agent: OrganizationAgent,
  projectDepartments: Map<number, number | null>,
): number | null {
  if (agent.departmentId != null) return agent.departmentId;
  if (agent.isHome || agent.template || agent.projects.length === 0) return null;
  const ids = new Set(agent.projects.map((project) => projectDepartments.get(project.id) ?? null));
  if (ids.size !== 1) return null;
  const [id] = [...ids];
  return id ?? null;
}

// All agents of a subtree, for the count next to a department.
export function countAgents(node: OrganizationDepartmentNode): number {
  const inAgents = (items: OrganizationAgentNode[]): number =>
    items.reduce((sum, item) => sum + 1 + inAgents(item.reports), 0);
  return inAgents(node.agents) + node.children.reduce((sum, child) => sum + countAgents(child), 0);
}

export function buildOrganizationTree(organization: Organization): OrganizationDepartmentNode[] {
  const projectDepartments = new Map<number, number | null>(
    organization.projects.map((project) => [project.id, project.departmentId ?? null]),
  );
  // Only departments this chart knows: an agent pointing at another one stays visible
  // (outside the departments) instead of disappearing.
  const known = new Set(organization.departments.map((department) => department.id));
  const departmentOf = (agent: OrganizationAgent) => {
    const id = agentDepartmentId(agent, projectDepartments);
    return id != null && known.has(id) ? id : null;
  };
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
  const placed = (agent: OrganizationAgent) => {
    const status = organizationAgentStatus(agent);
    return status === 'assigned' || (status === 'unassigned' && departmentOf(agent) != null);
  };
  for (const node of nodes.values()) {
    node.agents = agentTree(
      organization.agents.filter(
        (agent) =>
          placed(agent) &&
          departmentOf(agent) != null &&
          departmentOf(agent) === node.department?.id,
      ),
    );
    node.goals = goalTree(
      organization.goals.filter((goal) => goal.departmentId === node.department?.id),
    );
  }
  const withoutDepartment = organization.agents.filter(
    (agent) => agent.isHome || agent.template || departmentOf(agent) == null,
  );
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
  const restTree = agentTree(rest);
  const home = restTree.find((node) => node.agent.isHome);
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
  const result: OrganizationDepartmentNode[] = [];
  if (home) {
    // Home is the root of the chart: the departments hang under it, then its own
    // reports without a department (FAM/PRIV coordinators today).
    home.departments = roots;
    result.push({
      department: null,
      kind: 'home',
      agents: [home],
      goals: goalTree(withoutDepartmentGoals),
      children: [],
    });
  } else {
    result.push(...roots);
  }
  const others = restTree.filter((node) => node !== home);
  if (others.length > 0 || (!home && withoutDepartmentGoals.length > 0)) {
    result.push({
      department: null,
      kind: 'none',
      agents: others,
      goals: home ? [] : goalTree(withoutDepartmentGoals),
      children: [],
    });
  }
  if (templates.length > 0) {
    result.push({
      department: null,
      kind: 'templates',
      agents: agentTree(templates),
      goals: [],
      children: [],
    });
  }
  if (unassigned.length > 0) {
    result.push({
      department: null,
      kind: 'unassigned',
      agents: agentTree(unassigned),
      goals: [],
      children: [],
    });
  }
  return result;
}
