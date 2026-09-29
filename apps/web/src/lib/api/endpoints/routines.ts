import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { PipelineRun } from '@/lib/api/endpoints/pipelines';

export type RoutineMode = 'new' | 'reopen';

// What a fire that comes too late does, after the server was down: 'skip' records it as
// missed, 'once' runs the newest missed time once.
export type RoutineCatchUp = 'skip' | 'once';
export type RoutineGateMode = 'off' | 'shadow' | 'active';
export type RoutineGateSource = 'none' | 'mail' | 'audit';

// Why a routine's @mention of an agent starts no run of it: the agent works outside the
// project, an agent saved the routine (an agent's mentions start nobody), the agent takes
// work from its owner only, does not react to mentions, or is paused.
export type RoutineMentionReason =
  'not-in-project' | 'agent-author' | 'owner-only' | 'mentions-off' | 'paused';

// An agent the instructions @mention besides the routine's own, which every run starts on
// the routine's task too — unless `reason` says why not.
export interface RoutineMention {
  agent: { id: number; name: string; username: string };
  starts: boolean;
  reason: RoutineMentionReason | null;
}

// A routine: a schedule the Helena engine fires, which creates a task for an agent, or
// reopens one, on its cron. The API answers it with its project so Home can list several
// projects.
export interface Routine {
  id: string;
  projectKey: string;
  projectName: string;
  // Null when the agent no longer works in the project.
  agent: { id: number; name: string } | null;
  title: string;
  instructions: string;
  // For the member the routine acts for.
  mentions: RoutineMention[];
  mode: RoutineMode;
  // The task a 'reopen' routine reopens.
  task: { id: number; number: number; title: string } | null;
  cron: string;
  timezone: string;
  catchUp: RoutineCatchUp;
  gateMode: RoutineGateMode;
  gateSource: RoutineGateSource;
  // Checks before a fire whether there is new work at all (on by default).
  precheckEnabled?: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRun: {
    id: string;
    status: string;
    outcome: 'created' | 'reopened' | 'skipped' | null;
    // 'no-work': the precheck found nothing new (its last task is still open) and saved the
    // run (Paperclip's heartbeat precheck).
    skipReason: 'task-open' | 'missed' | 'gate' | 'no-work' | null;
    gate: {
      mode: RoutineGateMode;
      source: RoutineGateSource;
      recommendation: 'run' | 'skip';
      reason: string;
      counts: Record<string, number>;
      decisionId: number | null;
      confidence: number | null;
      status: string;
    } | null;
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
  catchUp: RoutineCatchUp;
  gateMode: RoutineGateMode;
  gateSource: RoutineGateSource;
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

// The runs of a routine, newest first: when each was due and what it did.
export const listRoutineRuns = (projectKey: string, routineId: string, params: PageParams) =>
  request<Page<PipelineRun>>(
    `/projects/${projectKey}/routines/${routineId}/runs${pageQuery(params)}`,
  );

export const runRoutine = (projectKey: string, routineId: string) =>
  request<{ runId: string }>(`/projects/${projectKey}/routines/${routineId}/run`, {
    method: 'POST',
  });

// The agents instructions being written would start, for the member writing them.
export const previewRoutineMentions = (
  projectKey: string,
  body: { instructions: string; agentId: number | null },
) =>
  request<RoutineMention[]>(`/projects/${projectKey}/routines/mentions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
