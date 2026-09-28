import { request } from '@/lib/api/core/client';
import type { IssueWhy } from './issues';

export interface ProjectWhyChain {
  why: IssueWhy;
  agent: { id: number; userId: string; name: string } | null;
}

export const getProjectWhyChains = (projectKey: string) =>
  request<ProjectWhyChain[]>(`/projects/${projectKey}/why-chains`);
export interface ProjectPoolGoal {
  id: number;
  title: string;
  description: string;
  status: 'planned' | 'active' | 'achieved' | 'paused';
  targetDate: string | null;
  parentGoalId: number | null;
  path: string[];
  scope: 'project' | 'department' | 'team';
  progress: { total: number; done: number } | null;
}
export interface ProjectGoalContext {
  goals: ProjectPoolGoal[];
  links: { initiativeId: number; goalId: number }[];
}
export const getProjectGoalContext = (projectKey: string) =>
  request<ProjectGoalContext>(`/projects/${projectKey}/goal-context`);
export const setProjectPoolGoal = (initiativeId: number, goalId: number | null) =>
  request<{ initiativeId: number; goalId: number | null }>(
    `/initiatives/${initiativeId}/pool-goal`,
    { method: 'PUT', body: JSON.stringify({ goalId }) },
  );
