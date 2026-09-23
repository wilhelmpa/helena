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

export interface OrganizationDepartmentNode {
  department: OrganizationDepartment | null;
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
    nodes.set(department.id, { department, agents: [], goals: [], children: [] });
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
  const unassigned = organization.agents.filter((agent) => agent.departmentId == null);
  if (unassigned.length > 0) {
    roots.push({
      department: null,
      agents: agentTree(unassigned),
      goals: goalTree(organization.goals.filter((goal) => goal.departmentId == null)),
      children: [],
    });
  } else {
    const unassignedGoals = organization.goals.filter((goal) => goal.departmentId == null);
    if (unassignedGoals.length > 0) {
      roots.push({ department: null, agents: [], goals: goalTree(unassignedGoals), children: [] });
    }
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
