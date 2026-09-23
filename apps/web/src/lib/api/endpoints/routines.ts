import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

export type RoutineMode = 'new' | 'reopen';

// A routine: a Mastra schedule that creates a task for an agent, or reopens one, on
// its cron. The API answers it with its project so Home can list several projects.
export interface Routine {
  id: string;
  projectKey: string;
  projectName: string;
  // Null when the agent no longer works in the project.
  agent: { id: number; name: string } | null;
  title: string;
  instructions: string;
  mode: RoutineMode;
  // The task a 'reopen' routine reopens.
  task: { id: number; number: number; title: string } | null;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRun: {
    status: string;
    outcome: 'created' | 'reopened' | 'skipped' | null;
    skipReason: 'task-open' | 'missed' | null;
    taskNumber: number | null;
    error: string | null;
    firedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineInput {
  agentId: number;
  title: string;
  instructions: string;
  mode: RoutineMode;
  taskId: number | null;
  cron: string;
  timezone: string;
}

export const listRoutines = (projectKey: string, params: PageParams) =>
  request<Page<Routine>>(`/projects/${projectKey}/routines${pageQuery(params)}`);

export const listMemberRoutines = (params: PageParams) =>
  request<Page<Routine>>(`/routines${pageQuery(params)}`);

// The key makes a repeated create, after a lost answer, return the routine it made.
export const createRoutine = (projectKey: string, idempotencyKey: string, input: RoutineInput) =>
  request<Routine>(`/projects/${projectKey}/routines`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey, ...input }),
  });

export const updateRoutine = (
  projectKey: string,
  routineId: string,
  patch: Partial<RoutineInput> & { enabled?: boolean },
) =>
  request<Routine>(`/projects/${projectKey}/routines/${routineId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteRoutine = (projectKey: string, routineId: string) =>
  request<void>(`/projects/${projectKey}/routines/${routineId}`, { method: 'DELETE' });

export const runRoutine = (projectKey: string, routineId: string) =>
  request<{ runId: string }>(`/projects/${projectKey}/routines/${routineId}/run`, {
    method: 'POST',
  });
