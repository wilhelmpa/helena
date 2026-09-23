import { request } from '@/lib/api/core/client';

export type OrganizationGoalStatus = 'planned' | 'active' | 'achieved' | 'paused';

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
  kind: 'external' | 'internal';
  departmentId: number | null;
  reportsToAgentId: number | null;
  roleTitle: string;
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
}

export interface OrganizationProject {
  id: number;
  key: string;
  name: string;
  description: string;
  departmentId: number | null;
  instructions: string;
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

export interface AgentAssignmentInput {
  departmentId?: number | null;
  reportsToAgentId?: number | null;
  roleTitle?: string;
  runtimeAgentId?: string | null;
}

export interface ProjectAssignmentInput {
  departmentId?: number | null;
  instructions?: string;
}

const base = (teamId: number) => `/teams/${teamId}/organization`;

export const getOrganization = (teamId: number) => request<Organization>(base(teamId));

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
