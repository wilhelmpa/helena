import type { RunFailureRef } from '@/lib/api/endpoints/modelAvailability';
import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { ApprovalDecision } from '@/lib/api/endpoints/approvals';

// The workflow builder: templates in the team's library in Home, a project's own
// workflows, their use in a project and their runs, which the Helena engine executes.
// The definition types mirror apps/api/src/modules/pipelines/definition.ts.

// The steps a person puts together in the builder.
export const STEP_KINDS = [
  'agent',
  'approval',
  'condition',
  'action',
  'wait',
  'notify',
  'webhook',
  'decision',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

// What a run can show besides: the work of a routine and of an agent team, which the
// engine builds itself.
export type RunStepKind = StepKind | 'delegate' | 'agent_team';

export const TRIGGER_TYPES = [
  'manual',
  'task_created',
  'task_assigned',
  'status_changed',
  'label_added',
  'schedule',
  'webhook',
  'mail_received',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

// A plugin's type is namespaced, `<plugin>.<name>`; Helena's own names have no dot.
export type PluginTypeName = `${string}.${string}`;

export const isPluginTypeName = (type: string): type is PluginTypeName => type.includes('.');

// What started a run: a builder trigger, a plugin's trigger, or a routine or an agent team
// (delegation).
export type RunTrigger = TriggerType | 'routine' | 'delegation' | PluginTypeName;

export type PipelineTrigger =
  | { type: 'manual' | 'task_created' | 'task_assigned' }
  // `to` is a status name; null fires on every change.
  | { type: 'status_changed'; to: string | null }
  | { type: 'label_added'; label: string }
  | { type: 'schedule'; cron: string; timezone: string; title: string }
  // Every request to the workflow's hook creates a task with `title` and runs on it.
  | { type: 'webhook'; title: string }
  // Every new mail that matches creates a task with its subject; empty filters match all.
  | { type: 'mail_received'; from: string; subject: string }
  // A plugin's trigger: its settings, as its schema describes them.
  | { type: PluginTypeName; config: Record<string, unknown> };

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
  // The day of the task's date field at `time` (HH:MM, the instance's time zone).
  | { kind: 'until'; field: 'dueDate' | 'startDate'; time: string };

export const NOTIFY_RECIPIENTS = ['assignee', 'watchers', 'members'] as const;
export type NotifyRecipients =
  { kind: 'assignee' } | { kind: 'watchers' } | { kind: 'members'; userIds: string[] };

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

// A typed decision (docs/helena-decisions/decisions.md §6): a decision model picks one of
// `options` for the context; `thenOptions` take the `then` lane. `from` reuses an earlier
// decision step's answer; `unsure` is where the run goes when the model is not sure enough.
export interface DecisionStep extends StepBase {
  type: 'decision';
  question: string;
  context: string;
  options: string[];
  thenOptions: string[];
  unsure: 'else' | 'then' | 'fail';
  from: string | null;
  then: PipelineStep[];
  else: PipelineStep[];
  thenEnd: boolean;
  elseEnd: boolean;
}

// The steps with two lanes of steps.
export type BranchingStep = ConditionStep | DecisionStep;

export const isBranching = (step: PipelineStep): step is BranchingStep =>
  step.type === 'condition' || step.type === 'decision';

export interface ActionStep extends StepBase {
  type: 'action';
  action: TaskAction;
}

export interface WaitStep extends StepBase {
  type: 'wait';
  wait: WaitSpec;
}

// Tells people about the run: a comment on the task and a notification.
export interface NotifyStep extends StepBase {
  type: 'notify';
  to: NotifyRecipients;
  message: string;
}

// Sends the task and the results so far to a URL, signed per Standard Webhooks with the
// project's signing secret. The answer's status decides the outcome.
export interface WebhookStep extends StepBase {
  type: 'webhook';
  url: string;
  message: string;
}

// A step of a plugin's type: its settings, as the type's schema describes them.
export interface PluginStep extends StepBase {
  type: PluginTypeName;
  config: Record<string, unknown>;
}

export type PipelineStep =
  | AgentStep
  | ApprovalStep
  | ConditionStep
  | DecisionStep
  | ActionStep
  | WaitStep
  | NotifyStep
  | WebhookStep
  | PluginStep;

export const isPluginStep = (step: PipelineStep): step is PluginStep => isPluginTypeName(step.type);

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
  'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'rejected' | 'skipped';

export interface PipelineRunStep {
  stepId: string;
  // The step a part belongs to, e.g. a stage of an agent team; null for a step.
  parentStepId: string | null;
  iteration: number;
  seq: number;
  kind: RunStepKind;
  name: string;
  status: 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'simulated' | 'skipped';
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
  // Why it failed, where the runtime's words said. Absent from an older server.
  failure?: RunFailureRef | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PipelineRun {
  id: string;
  // A run of a builder workflow, of the agent team of a task, or one of a routine.
  kind: 'workflow' | 'agent_team' | 'routine';
  pipelineId: number | null;
  // The workflow's name, the routine's title, or "Agent team".
  pipelineName: string;
  version: number | null;
  projectId: number;
  projectKey: string;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  // The schedule that fired the run and the time it was due.
  scheduleId: string | null;
  scheduledFor: string | null;
  trigger: RunTrigger;
  dryRun: boolean;
  status: PipelineRunStatus;
  error: string | null;
  failure?: RunFailureRef | null;
  // What the run produced, e.g. a routine's { outcome: 'created' | 'reopened' | 'skipped' }.
  result: unknown;
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

// The guard against workflows re-triggering each other without end (see
// modules/pipelines/rate-limit.ts on the API): at most maxRuns runs of any workflow
// may start on one task within windowMinutes, a fixed hour.
export interface PipelineRunLimit {
  maxRuns: number;
  windowMinutes: number;
}

export const getPipelineRunLimit = (projectKey: string) =>
  request<PipelineRunLimit>(`/projects/${projectKey}/pipeline-run-limit`);

export const setPipelineRunLimit = (projectKey: string, maxRuns: number) =>
  request<PipelineRunLimit>(`/projects/${projectKey}/pipeline-run-limit`, {
    method: 'PATCH',
    body: json({ maxRuns }),
  });

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
