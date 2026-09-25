import { request } from '@/lib/api/core/client';

export type OrganizationGoalStatus = 'planned' | 'active' | 'achieved' | 'paused';

export type AgentTeamRole = 'coordinator' | 'specialist' | 'reviewer';

export interface OrganizationDepartment {
  id: number;
  name: string;
  description: string;
  parentId: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationGoal {
  id: number;
  title: string;
  description: string;
  departmentId: number | null;
  projectId: number | null;
  parentGoalId: number | null;
  status: OrganizationGoalStatus;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  // Its linked tasks and the agents working on them, and the status proposals of agents
  // that wait for a decision.
  progress?: GoalProgress;
  pendingProposals?: number;
}

export interface GoalProgress {
  total: number;
  done: number;
  agents: { id: number; username: string; name: string }[];
}

export interface GoalPerson {
  name: string;
  username: string | null;
  agent: boolean;
}

export interface GoalTask {
  issueId: number;
  identifier: string;
  title: string;
  stateType: string;
  stateName: string;
  assignee: GoalPerson | null;
  running: boolean;
}

export interface GoalNote {
  id: number;
  body: string;
  author: GoalPerson | null;
  proposedStatus: OrganizationGoalStatus | null;
  decision: 'accepted' | 'rejected' | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface GoalDetail {
  id: number;
  title: string;
  status: OrganizationGoalStatus;
  path: string[];
  progress: GoalProgress;
  children: { id: number; title: string; status: OrganizationGoalStatus }[];
  tasks: GoalTask[];
  notes: GoalNote[];
}

export interface OrganizationAgentProject {
  id: number;
  key: string;
  name: string;
  instructions: string;
}

export interface OrganizationAgent {
  id: number;
  userId: string;
  name: string;
  username: string;
  kind: 'external';
  // Root of the reporting chain (Home master). Always counted as assigned, never shown
  // as a pool template or as an unassigned agent.
  isHome: boolean;
  // A pool template: runs nowhere, joins no project. Shown as "Vorlage", never as
  // unassigned, even though it carries no reportsToAgentId.
  template: boolean;
  departmentId: number | null;
  reportsToAgentId: number | null;
  roleTitle: string;
  role: AgentTeamRole | null;
  capabilities: string[];
  runtimeAgentId: string | null;
  runtimeState: {
    adapter: string | null;
    status: 'offline' | 'online' | 'degraded';
    appliedRevision: string | null;
    capabilities: string[];
    detail: string | null;
    conflicts: { path: string; content: string }[];
    reportedAt: string | null;
  };
  projects: OrganizationAgentProject[];
  // Set while the agent takes no new work, with why.
  pausedAt: string | null;
  pauseReason: string | null;
  // Null is no ceiling. Days and months are UTC.
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
  // What the agent's runs used in every project of the team.
  tokensToday: number;
  tokensThisMonth: number;
}

export interface OrganizationProject {
  id: number;
  key: string;
  name: string;
  description: string;
  departmentId: number | null;
  instructions: string;
  monthlyTokenCeiling: number | null;
  tokensThisMonth: number;
}

export interface Organization {
  teamId: number;
  departments: OrganizationDepartment[];
  goals: OrganizationGoal[];
  agents: OrganizationAgent[];
  projects: OrganizationProject[];
}

export interface DepartmentInput {
  name: string;
  description?: string;
  parentId?: number | null;
  position?: number;
}

export interface GoalInput {
  title: string;
  description?: string;
  departmentId?: number | null;
  projectId?: number | null;
  parentGoalId?: number | null;
  status?: OrganizationGoalStatus;
  targetDate?: string | null;
}

// role and capabilities keep their stored values when left out.
export interface AgentAssignmentInput {
  departmentId?: number | null;
  reportsToAgentId?: number | null;
  roleTitle?: string;
  role?: AgentTeamRole | null;
  capabilities?: string[];
  runtimeAgentId?: string | null;
}

export interface ProjectAssignmentInput {
  departmentId?: number | null;
  instructions?: string;
}

const base = (teamId: number) => `/teams/${teamId}/organization`;

// With projectId, the agents are the ones working in that project, the Home agent left
// out.
export const getOrganization = (teamId: number, projectId?: number) =>
  request<Organization>(`${base(teamId)}${projectId != null ? `?projectId=${projectId}` : ''}`);

export const createDepartment = (teamId: number, input: DepartmentInput) =>
  request<OrganizationDepartment>(`${base(teamId)}/departments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateDepartment = (
  teamId: number,
  departmentId: number,
  input: Partial<DepartmentInput>,
) =>
  request<OrganizationDepartment>(`${base(teamId)}/departments/${departmentId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteDepartment = (teamId: number, departmentId: number) =>
  request<void>(`${base(teamId)}/departments/${departmentId}`, { method: 'DELETE' });

export const createGoal = (teamId: number, input: GoalInput) =>
  request<OrganizationGoal>(`${base(teamId)}/goals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateGoal = (teamId: number, goalId: number, input: Partial<GoalInput>) =>
  request<OrganizationGoal>(`${base(teamId)}/goals/${goalId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteGoal = (teamId: number, goalId: number) =>
  request<void>(`${base(teamId)}/goals/${goalId}`, { method: 'DELETE' });

export const setAgentAssignment = (teamId: number, agentId: number, input: AgentAssignmentInput) =>
  request<void>(`${base(teamId)}/agents/${agentId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const clearAgentAssignment = (teamId: number, agentId: number) =>
  request<void>(`${base(teamId)}/agents/${agentId}`, { method: 'DELETE' });

export const setProjectAssignment = (
  teamId: number,
  projectId: number,
  input: ProjectAssignmentInput,
) =>
  request<void>(`${base(teamId)}/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const clearProjectAssignment = (teamId: number, projectId: number) =>
  request<void>(`${base(teamId)}/projects/${projectId}`, { method: 'DELETE' });

export const setAgentProjectInstructions = (
  teamId: number,
  agentId: number,
  projectId: number,
  instructions: string,
) =>
  request<void>(`${base(teamId)}/agents/${agentId}/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ instructions }),
  });

export const pauseAgent = (teamId: number, agentId: number) =>
  request<void>(`${base(teamId)}/agents/${agentId}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const resumeAgent = (teamId: number, agentId: number) =>
  request<void>(`${base(teamId)}/agents/${agentId}/resume`, { method: 'POST' });

export interface AgentTokenCeilings {
  daily: number | null;
  monthly: number | null;
}

export const setAgentTokenCeilings = (
  teamId: number,
  agentId: number,
  ceilings: AgentTokenCeilings,
) =>
  request<void>(`${base(teamId)}/agents/${agentId}/token-ceilings`, {
    method: 'PUT',
    body: JSON.stringify(ceilings),
  });

export const setProjectTokenCeiling = (teamId: number, projectId: number, monthly: number | null) =>
  request<void>(`${base(teamId)}/projects/${projectId}/token-ceiling`, {
    method: 'PUT',
    body: JSON.stringify({ monthly }),
  });

// A goal with its linked tasks and notes (modules/goals).
export const getGoalDetail = (teamId: number, goalId: number) =>
  request<GoalDetail>(`/teams/${teamId}/goals/${goalId}`);

// Accepts or rejects an agent's proposed status; accepting sets it.
export const decideGoalNote = (teamId: number, goalId: number, noteId: number, accept: boolean) =>
  request<GoalNote>(`/teams/${teamId}/goals/${goalId}/notes/${noteId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  });
