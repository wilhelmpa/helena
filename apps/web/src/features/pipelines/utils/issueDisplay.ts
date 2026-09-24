import {
  isPluginStep,
  type DefinitionIssue,
  type PipelineStep,
  type StepKind,
} from '@/lib/api/endpoints/pipelines';

// Where the editor shows each problem the API names: on the step card and under the
// field of the inspector it belongs to, on the trigger or role card, or in the list
// above the builder.

// Problems of the workflow in its project. They do not block saving; they keep the
// workflow from being enabled there.
export const PROJECT_ISSUE_CODES: readonly string[] = [
  'role_unresolved',
  'agent_not_in_project',
  'member_not_in_project',
  'unknown_status',
  'unknown_label',
  'unknown_area',
  'model_not_allowed',
  'schedule_too_frequent',
];

export const isProjectIssue = (issue: DefinitionIssue) => PROJECT_ISSUE_CODES.includes(issue.code);

export function splitIssues(issues: DefinitionIssue[]) {
  return {
    blocking: issues.filter((issue) => !isProjectIssue(issue)),
    warnings: issues.filter(isProjectIssue),
  };
}

// The fields the inspector renders for each kind of step, besides the name.
export const STEP_FIELDS: Record<StepKind, readonly string[]> = {
  agent: ['assignee', 'instruction', 'maxTurns', 'runBudgetSeconds', 'model', 'timeoutMinutes'],
  approval: ['message', 'onReject.action', 'onReject.stepId', 'onReject.maxLoops'],
  condition: [
    'condition.kind',
    'condition.outcomes',
    'condition.keyword',
    'condition.field',
    'condition.op',
    'condition.values',
  ],
  action: [
    'action.kind',
    'action.status',
    'action.labels',
    'action.assignee',
    'action.body',
    'action.title',
    'action.description',
  ],
  wait: ['wait.kind', 'wait.minutes', 'wait.time', 'wait.field'],
  notify: ['to.kind', 'to.userIds', 'message'],
  webhook: ['url', 'message'],
};

export const stepIssues = (issues: DefinitionIssue[], stepId: string) =>
  issues.filter((issue) => issue.stepId === stepId);

export const fieldIssues = (issues: DefinitionIssue[], stepId: string, field: string) =>
  issues.filter((issue) => issue.stepId === stepId && issue.field === field);

// The problems of a step that no field of the inspector shows: the whole step (too
// deep, unreachable), its id, or a role it names.
// A plugin's step shows the problems of its settings (`config.<field>`) under the fields
// its form draws, and the ones of its settings as a whole on top.
export function unplacedStepIssues(issues: DefinitionIssue[], step: PipelineStep) {
  if (isPluginStep(step))
    return stepIssues(issues, step.id).filter(
      (issue) =>
        issue.field === null || (issue.field !== 'name' && !issue.field.startsWith('config.')),
    );
  const placed = new Set(['name', ...STEP_FIELDS[step.type]]);
  return stepIssues(issues, step.id).filter(
    (issue) => issue.field === null || !placed.has(issue.field),
  );
}

export const triggerIssues = (issues: DefinitionIssue[]) =>
  issues.filter((issue) => issue.stepId === null && issue.field?.startsWith('trigger.'));

export const roleIssues = (issues: DefinitionIssue[], key: string) =>
  issues.filter(
    (issue) => issue.field === `roles.${key}` || issue.field?.startsWith(`roles.${key}.`),
  );

// The problems of the workflow as a whole: no steps, too many steps or roles.
export const workflowIssues = (issues: DefinitionIssue[]) =>
  issues.filter(
    (issue) =>
      issue.stepId === null &&
      !issue.field?.startsWith('trigger.') &&
      !issue.field?.startsWith('roles.'),
  );

export const issueKey = (issue: DefinitionIssue, index: number) =>
  `${index}:${issue.code}:${issue.stepId}:${issue.field}`;
