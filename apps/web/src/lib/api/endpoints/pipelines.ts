import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { ApprovalDecision } from '@/lib/api/endpoints/approvals';

// The workflow builder: templates in the team's library in Home, a project's own
// workflows, their use in a project and their runs. The definition types mirror
// apps/api/src/modules/pipelines/definition.ts.

export const STEP_KINDS = ['agent', 'approval', 'condition', 'action', 'wait'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const TRIGGER_TYPES = [
  'manual',
  'task_created',
  'task_assigned',
  'status_changed',
  'label_added',
  'schedule',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export type PipelineTrigger =
  | { type: 'manual' | 'task_created' | 'task_assigned' }
  // `to` is a status name; null fires on every change.
  | { type: 'status_changed'; to: string | null }
  | { type: 'label_added'; label: string }
  | { type: 'schedule'; cron: string; timezone: string; title: string };

export type RoleMatch =
  | { type: 'coordinator' }
  | { type: 'capability'; capability: string }
  | { type: 'template'; agentId: number }
  | { type: 'none' };

export interface PipelineRole {
  key: string;
  name: string;
  match: RoleMatch;
}

export type Assignee = { role: string } | { agentId: number };

export const OUTCOMES = ['success', 'failed', 'blocked'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const TASK_FIELDS = ['status', 'statusType', 'labels', 'area', 'priority'] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

export type ConditionTest =
  | { kind: 'outcome'; outcomes: Outcome[] }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'task'; field: TaskField; op: 'is' | 'is_not'; values: string[] };

export const ACTION_KINDS = [
  'set_status',
  'add_labels',
  'remove_labels',
  'set_assignee',
  'comment',
  'create_subtask',
] as const;

export type TaskAction =
  | { kind: 'set_status'; status: string }
  | { kind: 'add_labels' | 'remove_labels'; labels: string[] }
  | { kind: 'set_assignee'; assignee: { role: string } | { userId: string } | null }
  | { kind: 'comment'; body: string }
  | { kind: 'create_subtask'; title: string; description: string };

export type WaitSpec =
  | { kind: 'delay'; minutes: number }
  // The day of the task's date field at `time` (HH:MM, Europe/Berlin).
  | { kind: 'until'; field: 'dueDate' | 'startDate'; time: string };

interface StepBase {
  id: string;
  name: string;
}

export interface AgentStep extends StepBase {
  type: 'agent';
  assignee: Assignee;
  instruction: string;
  maxTurns: number | null;
  runBudgetSeconds: number | null;
  model: string | null;
  timeoutMinutes: number;
}

export interface ApprovalStep extends StepBase {
  type: 'approval';
  message: string;
  onReject: { action: 'end' } | { action: 'goto'; stepId: string; maxLoops: number };
}

export interface ConditionStep extends StepBase {
  type: 'condition';
  condition: ConditionTest;
  then: PipelineStep[];
  else: PipelineStep[];
  thenEnd: boolean;
  elseEnd: boolean;
}

export interface ActionStep extends StepBase {
  type: 'action';
  action: TaskAction;
}

export interface WaitStep extends StepBase {
  type: 'wait';
  wait: WaitSpec;
}

export type PipelineStep = AgentStep | ApprovalStep | ConditionStep | ActionStep | WaitStep;

export interface PipelineDefinition {
  schemaVersion: 1;
  trigger: PipelineTrigger;
  roles: PipelineRole[];
  steps: PipelineStep[];
}

export interface DefinitionIssue {
  code: string;
  // The step the issue belongs to; null for the trigger, the roles or the whole list.
  stepId: string | null;
  // The field of the step, trigger or role, e.g. 'instruction' or 'roles.coder.name'.
  field: string | null;
  params?: Record<string, string | number>;
  message: string;
}

export interface Pipeline {
  id: number;
  teamId: number;
  // Null for a template of the Home library.
  projectId: number | null;
  projectKey: string | null;
  name: string;
  description: string;
  version: number;
  definition: PipelineDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineInput {
  name: string;
  description?: string;
  definition: PipelineDefinition;
}

export interface PipelineVersion {
  id: number;
  version: number;
  createdByName: string | null;
  createdAt: string;
}

export interface PipelineVersionDetail {
  version: number;
  definition: PipelineDefinition;
  createdAt: string;
}

export interface BuiltinPipeline {
  key: string;
  name: string;
  description: string;
  definition: PipelineDefinition;
}

export interface PipelineContextAgent {
  id: number;
  username: string;
  name: string;
  role: string | null;
  capabilities: string[];
}

// What the editor offers in its pickers. A team's library knows its template agents
// and models; a project adds its agents, members, statuses, labels and areas.
export interface PipelineContext {
  models: string[];
  templates: { id: number; username: string; name: string }[];
  agents: PipelineContextAgent[];
  members: { id: string; name: string }[];
  statuses: { id: number; name: string; stateType: string }[];
  labels: { id: number; name: string }[];
  areas: { id: number; name: string }[];
}

export interface ProjectPipeline {
  pipeline: Pipeline;
  source: 'template' | 'project';
  enabled: boolean;
  // Role key → agent id, as the project names them.
  roles: Record<string, number>;
  resolvedRoles: {
    key: string;
    name: string;
    agent: PipelineContextAgent | null;
    source: 'mapping' | 'match' | null;
  }[];
  // What keeps the workflow from running in the project.
  issues: DefinitionIssue[];
}

export type PipelineRunStatus =
  'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'rejected';

export interface PipelineRunStep {
  stepId: string;
  iteration: number;
  seq: number;
  kind: StepKind;
  name: string;
  status: 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'simulated';
  // agent: success | failed | blocked; approval: approved | rejected; condition:
  // true | false; action and wait: success.
  outcome: string | null;
  summary: string | null;
  attempt: number;
  agent: { id: number; username: string; name: string } | null;
  agentRun: {
    id: number;
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
  decidedByName: string | null;
  note: string | null;
  wakeAt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PipelineRun {
  id: string;
  pipelineId: number;
  pipelineName: string;
  version: number;
  projectId: number;
  projectKey: string;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  trigger: TriggerType;
  dryRun: boolean;
  status: PipelineRunStatus;
  error: string | null;
  actorName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  steps: PipelineRunStep[];
}

export interface PipelineRunFilters {
  projectKey?: string;
  status?: PipelineRunStatus;
  dryRun?: boolean;
}

export interface StartablePipeline {
  id: number;
  name: string;
  description: string;
}

// An approval step of a run that waits for a person.
export interface PipelineApproval {
  runId: string;
  stepId: string;
  iteration: number;
  stepName: string;
  message: string | null;
  pipelineId: number;
  pipelineName: string;
  projectKey: string;
  projectName: string;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  waitingSince: string;
}

const json = (body: unknown) => JSON.stringify(body);

export const listPipelineTemplates = (teamId: number) =>
  request<Pipeline[]>(`/teams/${teamId}/pipelines`);

export const createPipelineTemplate = (teamId: number, input: PipelineInput) =>
  request<Pipeline>(`/teams/${teamId}/pipelines`, { method: 'POST', body: json(input) });

export const listBuiltinPipelines = (teamId: number) =>
  request<BuiltinPipeline[]>(`/teams/${teamId}/pipeline-builtins`);

export const getTeamPipelineContext = (teamId: number) =>
  request<PipelineContext>(`/teams/${teamId}/pipeline-context`);

export const validatePipelineTemplate = (teamId: number, definition: PipelineDefinition) =>
  request<{ issues: DefinitionIssue[] }>(`/teams/${teamId}/pipelines/validate`, {
    method: 'POST',
    body: json({ definition, template: true }),
  });

export const listProjectPipelines = (projectKey: string) =>
  request<ProjectPipeline[]>(`/projects/${projectKey}/pipelines`);

export const createProjectPipeline = (projectKey: string, input: PipelineInput) =>
  request<Pipeline>(`/projects/${projectKey}/pipelines`, { method: 'POST', body: json(input) });

export const setProjectPipeline = (
  projectKey: string,
  pipelineId: number,
  input: { enabled: boolean; roles: Record<string, number> },
) =>
  request<ProjectPipeline>(`/projects/${projectKey}/pipelines/${pipelineId}`, {
    method: 'PUT',
    body: json(input),
  });

export const getProjectPipelineContext = (projectKey: string) =>
  request<PipelineContext>(`/projects/${projectKey}/pipeline-context`);

export const validateProjectPipeline = (
  projectKey: string,
  input: { definition: PipelineDefinition; template: boolean; roles?: Record<string, number> },
) =>
  request<{ issues: DefinitionIssue[] }>(`/projects/${projectKey}/pipelines/validate`, {
    method: 'POST',
    body: json(input),
  });

export const getPipeline = (pipelineId: number) => request<Pipeline>(`/pipelines/${pipelineId}`);

export const updatePipeline = (
  pipelineId: number,
  patch: Partial<PipelineInput> & { baseVersion?: number },
) => request<Pipeline>(`/pipelines/${pipelineId}`, { method: 'PATCH', body: json(patch) });

export const deletePipeline = (pipelineId: number) =>
  request<void>(`/pipelines/${pipelineId}`, { method: 'DELETE' });

export const listPipelineVersions = (pipelineId: number) =>
  request<PipelineVersion[]>(`/pipelines/${pipelineId}/versions`);

export const getPipelineVersion = (pipelineId: number, version: number) =>
  request<PipelineVersionDetail>(`/pipelines/${pipelineId}/versions/${version}`);

export const listPipelineRuns = (
  pipelineId: number,
  params: PageParams,
  filters: PipelineRunFilters,
) =>
  request<Page<PipelineRun>>(
    `/pipelines/${pipelineId}/runs${pageQuery(params, {
      projectKey: filters.projectKey,
      status: filters.status,
      dryRun: filters.dryRun === undefined ? undefined : String(filters.dryRun),
    })}`,
  );

export const listStartablePipelines = (issueId: number) =>
  request<StartablePipeline[]>(`/issues/${issueId}/pipelines`);

export const listIssuePipelineRuns = (issueId: number) =>
  request<PipelineRun[]>(`/issues/${issueId}/pipeline-runs`);

export const startPipelineRun = (issueId: number, pipelineId: number, dryRun = false) =>
  request<PipelineRun>(`/issues/${issueId}/pipeline-runs`, {
    method: 'POST',
    body: json({ pipelineId, dryRun }),
  });

export const getPipelineRun = (runId: string) => request<PipelineRun>(`/pipeline-runs/${runId}`);

export const cancelPipelineRun = (runId: string) =>
  request<PipelineRun>(`/pipeline-runs/${runId}/cancel`, { method: 'POST' });

export const retryPipelineRun = (runId: string) =>
  request<PipelineRun>(`/pipeline-runs/${runId}/retry`, { method: 'POST' });

export const decidePipelineApproval = (runId: string, decision: ApprovalDecision) =>
  request<PipelineRun>(`/pipeline-runs/${runId}/approval`, {
    method: 'POST',
    body: json(decision),
  });

export const listPipelineApprovals = () => request<PipelineApproval[]>('/pipeline-approvals');
