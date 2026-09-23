import { maxTurnsLimit, runBudgetSecondsLimit } from '#modules/agents/model';
import { minCronIntervalSeconds } from '#modules/routines/cron';

// A workflow definition: a trigger, the roles its agent steps name, and an ordered list
// of steps. A condition step holds two lanes of steps, one for each answer; after its
// lane the run continues with the step after the condition, or ends when the lane says
// so. Mastra's plan-pipeline workflow interprets the definition a run pinned
// (pipeline-contracts.ts there holds the same shape).

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
  // Every fire creates a task with `title` and runs the workflow on it.
  | { type: 'schedule'; cron: string; timezone: string; title: string };

// How a role finds its agent in a project that sets none for it.
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

export type Outcome = 'success' | 'failed' | 'blocked';

export type ConditionTest =
  | { kind: 'outcome'; outcomes: Outcome[] }
  | { kind: 'keyword'; keyword: string }
  | {
      kind: 'task';
      field: 'status' | 'statusType' | 'labels' | 'area' | 'priority';
      op: 'is' | 'is_not';
      values: string[];
    };

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
}

export const LIMITS = {
  steps: 50,
  depth: 3,
  roles: 12,
  name: 120,
  text: 8_000,
  message: 2_000,
  values: 20,
  maxLoops: 10,
  timeoutMinutes: { minimum: 5, maximum: 1_440 },
  delayMinutes: { minimum: 1, maximum: 43_200 },
} as const;

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROLE_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OUTCOMES = ['success', 'failed', 'blocked'] as const;
const TASK_FIELDS = ['status', 'statusType', 'labels', 'area', 'priority'] as const;
const DATE_FIELDS = ['dueDate', 'startDate'] as const;
const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const TASK_VARIABLES = new Set(['title', 'description', 'identifier', 'status']);
const RESULT_VARIABLES = new Set(['summary', 'outcome', 'note']);

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

class Reader {
  issues: DefinitionIssue[] = [];

  constructor(
    private stepId: string | null,
    private prefix = '',
  ) {}

  issue(code: string, field: string | null, params?: DefinitionIssue['params']) {
    this.issues.push({
      code,
      stepId: this.stepId,
      field: field === null ? null : this.prefix + field,
      ...(params ? { params } : {}),
    });
  }

  text(value: unknown, field: string, max: number, required = true): string {
    if (typeof value !== 'string') {
      if (required || value !== undefined) this.issue('required', field);
      return '';
    }
    const trimmed = value.trim();
    if (required && !trimmed) this.issue('required', field);
    else if (trimmed.length > max) this.issue('too_long', field, { max });
    return trimmed;
  }

  integer(value: unknown, field: string, limit: { minimum: number; maximum: number }): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.issue('required', field);
      return limit.minimum;
    }
    if (value < limit.minimum || value > limit.maximum)
      this.issue('out_of_range', field, { min: limit.minimum, max: limit.maximum });
    return value;
  }

  optionalInteger(
    value: unknown,
    field: string,
    limit: { minimum: number; maximum: number },
  ): number | null {
    return value === undefined || value === null ? null : this.integer(value, field, limit);
  }

  choice<T extends string>(value: unknown, field: string, options: readonly T[]): T {
    if (typeof value === 'string' && (options as readonly string[]).includes(value))
      return value as T;
    this.issue('invalid', field);
    return options[0];
  }

  names(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      this.issue('required', field);
      return [];
    }
    if (value.length > LIMITS.values) this.issue('too_many', field, { max: LIMITS.values });
    return value.map((item) => this.text(item, field, LIMITS.name));
  }
}

function readTrigger(raw: unknown, reader: Reader): PipelineTrigger {
  const value = record(raw);
  const type = reader.choice(value?.type, 'trigger.type', TRIGGER_TYPES);
  if (type === 'status_changed') {
    const to = value?.to;
    return {
      type,
      to: to === null || to === undefined ? null : reader.text(to, 'trigger.to', LIMITS.name),
    };
  }
  if (type === 'label_added')
    return { type, label: reader.text(value?.label, 'trigger.label', LIMITS.name) };
  if (type === 'schedule') {
    const cron = reader.text(value?.cron, 'trigger.cron', 120);
    const timezone = reader.text(value?.timezone, 'trigger.timezone', 80);
    const title = reader.text(value?.title, 'trigger.title', 300);
    if (cron && timezone) {
      try {
        minCronIntervalSeconds(cron, timezone);
      } catch (error) {
        reader.issue(
          error instanceof Error && /zone/i.test(error.message)
            ? 'invalid_timezone'
            : 'invalid_cron',
          error instanceof Error && /zone/i.test(error.message)
            ? 'trigger.timezone'
            : 'trigger.cron',
        );
      }
    }
    return { type, cron, timezone, title };
  }
  return { type };
}

function readRole(raw: unknown, index: number, issues: DefinitionIssue[]): PipelineRole {
  const value = record(raw);
  const key = typeof value?.key === 'string' ? value.key : '';
  const reader = new Reader(null, `roles.${key || index}.`);
  if (!ROLE_KEY.test(key)) reader.issue('invalid', 'key');
  const name = reader.text(value?.name, 'name', 80);
  const match = record(value?.match);
  const type = reader.choice(match?.type, 'match', [
    'coordinator',
    'capability',
    'template',
    'none',
  ] as const);
  let parsed: RoleMatch = { type: 'none' };
  if (type === 'coordinator') parsed = { type };
  else if (type === 'capability')
    parsed = { type, capability: reader.text(match?.capability, 'match.capability', 100) };
  else if (type === 'template')
    parsed = {
      type,
      agentId: reader.integer(match?.agentId, 'match.agentId', {
        minimum: 1,
        maximum: 2 ** 31 - 1,
      }),
    };
  issues.push(...reader.issues);
  return { key, name, match: parsed };
}

function readAssignee(raw: unknown, reader: Reader): Assignee {
  const value = record(raw);
  if (typeof value?.role === 'string') return { role: value.role };
  if (typeof value?.agentId === 'number' && Number.isInteger(value.agentId) && value.agentId > 0)
    return { agentId: value.agentId };
  reader.issue('required', 'assignee');
  return { role: '' };
}

function readCondition(raw: unknown, reader: Reader): ConditionTest {
  const value = record(raw);
  const kind = reader.choice(value?.kind, 'condition.kind', [
    'outcome',
    'keyword',
    'task',
  ] as const);
  if (kind === 'outcome') {
    const outcomes = Array.isArray(value?.outcomes) ? value.outcomes : [];
    const valid = [...new Set(outcomes)].filter((item): item is Outcome =>
      (OUTCOMES as readonly unknown[]).includes(item),
    );
    if (valid.length === 0 || valid.length !== outcomes.length)
      reader.issue('required', 'condition.outcomes');
    return { kind, outcomes: valid };
  }
  if (kind === 'keyword')
    return { kind, keyword: reader.text(value?.keyword, 'condition.keyword', 200) };
  return {
    kind,
    field: reader.choice(value?.field, 'condition.field', TASK_FIELDS),
    op: reader.choice(value?.op, 'condition.op', ['is', 'is_not'] as const),
    values: reader.names(value?.values, 'condition.values'),
  };
}

function readAction(raw: unknown, reader: Reader): TaskAction {
  const value = record(raw);
  const kind = reader.choice(value?.kind, 'action.kind', [
    'set_status',
    'add_labels',
    'remove_labels',
    'set_assignee',
    'comment',
    'create_subtask',
  ] as const);
  switch (kind) {
    case 'set_status':
      return { kind, status: reader.text(value?.status, 'action.status', LIMITS.name) };
    case 'add_labels':
    case 'remove_labels':
      return { kind, labels: reader.names(value?.labels, 'action.labels') };
    case 'set_assignee': {
      const assignee = record(value?.assignee);
      if (value?.assignee === null) return { kind, assignee: null };
      if (typeof assignee?.role === 'string') return { kind, assignee: { role: assignee.role } };
      if (typeof assignee?.userId === 'string' && assignee.userId.length <= 100)
        return { kind, assignee: { userId: assignee.userId } };
      reader.issue('required', 'action.assignee');
      return { kind, assignee: null };
    }
    case 'comment':
      return { kind, body: reader.text(value?.body, 'action.body', LIMITS.text) };
    case 'create_subtask':
      return {
        kind,
        title: reader.text(value?.title, 'action.title', 300),
        description: reader.text(
          value?.description ?? '',
          'action.description',
          LIMITS.text,
          false,
        ),
      };
  }
}

function readWait(raw: unknown, reader: Reader): WaitSpec {
  const value = record(raw);
  const kind = reader.choice(value?.kind, 'wait.kind', ['delay', 'until'] as const);
  if (kind === 'delay')
    return { kind, minutes: reader.integer(value?.minutes, 'wait.minutes', LIMITS.delayMinutes) };
  const time = typeof value?.time === 'string' ? value.time : '';
  if (!TIME.test(time)) reader.issue('invalid', 'wait.time');
  return { kind, field: reader.choice(value?.field, 'wait.field', DATE_FIELDS), time };
}

function readSteps(
  raw: unknown,
  depth: number,
  issues: DefinitionIssue[],
  counter: { count: number },
): PipelineStep[] {
  if (!Array.isArray(raw)) {
    issues.push({ code: 'invalid', stepId: null, field: 'steps' });
    return [];
  }
  return raw.map((item) => readStep(item, depth, issues, counter));
}

function readStep(
  raw: unknown,
  depth: number,
  issues: DefinitionIssue[],
  counter: { count: number },
): PipelineStep {
  counter.count += 1;
  const value = record(raw);
  const id = typeof value?.id === 'string' ? value.id : '';
  const reader = new Reader(id || null);
  if (!STEP_ID.test(id)) reader.issue('invalid', 'id');
  const name = reader.text(value?.name, 'name', LIMITS.name);
  const type = reader.choice(value?.type, 'type', STEP_KINDS);
  let step: PipelineStep;
  switch (type) {
    case 'agent':
      step = {
        id,
        name,
        type,
        assignee: readAssignee(value?.assignee, reader),
        instruction: reader.text(value?.instruction, 'instruction', LIMITS.text),
        maxTurns: reader.optionalInteger(value?.maxTurns, 'maxTurns', maxTurnsLimit),
        runBudgetSeconds: reader.optionalInteger(
          value?.runBudgetSeconds,
          'runBudgetSeconds',
          runBudgetSecondsLimit,
        ),
        model:
          value?.model === undefined || value?.model === null || value?.model === ''
            ? null
            : reader.text(value.model, 'model', 200),
        timeoutMinutes: reader.integer(
          value?.timeoutMinutes,
          'timeoutMinutes',
          LIMITS.timeoutMinutes,
        ),
      };
      break;
    case 'approval': {
      const onReject = record(value?.onReject);
      const action = reader.choice(onReject?.action, 'onReject.action', ['end', 'goto'] as const);
      step = {
        id,
        name,
        type,
        message: reader.text(value?.message ?? '', 'message', LIMITS.message, false),
        onReject:
          action === 'end'
            ? { action }
            : {
                action,
                stepId: typeof onReject?.stepId === 'string' ? onReject.stepId : '',
                maxLoops: reader.integer(onReject?.maxLoops, 'onReject.maxLoops', {
                  minimum: 1,
                  maximum: LIMITS.maxLoops,
                }),
              },
      };
      break;
    }
    case 'condition': {
      if (depth > LIMITS.depth) reader.issue('too_deep', null, { max: LIMITS.depth });
      step = {
        id,
        name,
        type,
        condition: readCondition(value?.condition, reader),
        then: readSteps(value?.then ?? [], depth + 1, issues, counter),
        else: readSteps(value?.else ?? [], depth + 1, issues, counter),
        thenEnd: value?.thenEnd === true,
        elseEnd: value?.elseEnd === true,
      };
      break;
    }
    case 'action':
      step = { id, name, type, action: readAction(value?.action, reader) };
      break;
    case 'wait':
      step = { id, name, type, wait: readWait(value?.wait, reader) };
      break;
  }
  issues.push(...reader.issues);
  return step;
}

// Every step in document order: the order a reader sees them, a condition before the
// steps of its lanes. `path` are the steps a run passed through to reach the step: the
// earlier steps of its lane and of every lane around it, the conditions around it
// (`ancestors`) included.
export interface FlatStep {
  step: PipelineStep;
  index: number;
  path: PipelineStep[];
  ancestors: ConditionStep[];
}

export function flattenSteps(steps: PipelineStep[]): FlatStep[] {
  const flat: FlatStep[] = [];
  const walk = (lane: PipelineStep[], before: PipelineStep[], ancestors: ConditionStep[]) => {
    lane.forEach((step, position) => {
      const path = [...before, ...lane.slice(0, position)];
      flat.push({ step, index: flat.length, path, ancestors });
      if (step.type === 'condition') {
        walk(step.then, [...path, step], [...ancestors, step]);
        walk(step.else, [...path, step], [...ancestors, step]);
      }
    });
  };
  walk(steps, [], []);
  return flat;
}

export function findStep(steps: PipelineStep[], id: string): PipelineStep | undefined {
  return flattenSteps(steps).find((entry) => entry.step.id === id)?.step;
}

function descendants(step: PipelineStep): PipelineStep[] {
  return step.type === 'condition'
    ? [...step.then, ...step.else].flatMap((child) => [child, ...descendants(child)])
    : [];
}

// The steps a run may have executed before it reaches the step: its path, and the
// lanes of the earlier conditions on it.
export function stepsBefore(entry: FlatStep): PipelineStep[] {
  return entry.path.flatMap((step) =>
    step.type === 'condition' && !entry.ancestors.includes(step)
      ? [step, ...descendants(step)]
      : [step],
  );
}

// The {{…}} variables of a text, as written between the braces.
export function variablesIn(text: string): string[] {
  return [...text.matchAll(VARIABLE)].map((match) => match[1]);
}

// The fields of a step whose text may hold variables.
export function templateFields(step: PipelineStep): { field: string; text: string }[] {
  if (step.type === 'agent') return [{ field: 'instruction', text: step.instruction }];
  if (step.type === 'approval') return [{ field: 'message', text: step.message }];
  if (step.type === 'action' && step.action.kind === 'comment')
    return [{ field: 'action.body', text: step.action.body }];
  if (step.type === 'action' && step.action.kind === 'create_subtask')
    return [
      { field: 'action.title', text: step.action.title },
      { field: 'action.description', text: step.action.description },
    ];
  return [];
}

// A step that leaves a result the next steps read as `previous`. A condition and a wait
// only decide where and when the run goes on.
export function producesResult(step: PipelineStep): boolean {
  return step.type === 'agent' || step.type === 'approval' || step.type === 'action';
}

function checkVariables(entry: FlatStep, ids: Set<string>, issues: DefinitionIssue[]) {
  const { step } = entry;
  const before = stepsBefore(entry);
  const beforeIds = new Set(before.map((candidate) => candidate.id));
  const hasPrevious = before.some(producesResult);
  for (const { field, text } of templateFields(step)) {
    for (const variable of variablesIn(text)) {
      const parts = variable.split('.');
      const report = (code: string) =>
        issues.push({ code, stepId: step.id, field, params: { variable } });
      if (parts[0] === 'task' && parts.length === 2 && TASK_VARIABLES.has(parts[1])) continue;
      if (parts[0] === 'previous' && parts.length === 2 && RESULT_VARIABLES.has(parts[1])) {
        if (!hasPrevious) report('no_previous_step');
        continue;
      }
      if (parts[0] === 'step' && parts.length === 3 && RESULT_VARIABLES.has(parts[2])) {
        if (!ids.has(parts[1])) report('unknown_step_variable');
        else if (!beforeIds.has(parts[1])) report('step_variable_not_before');
        continue;
      }
      report('unknown_variable');
    }
  }
}

// The steps no run reaches: those after a condition in its lane when both of its lanes
// end the run.
function unreachable(steps: PipelineStep[]): PipelineStep[] {
  const found: PipelineStep[] = [];
  const walk = (lane: PipelineStep[]) => {
    let ended = false;
    for (const step of lane) {
      if (ended) found.push(step);
      if (step.type === 'condition') {
        walk(step.then);
        walk(step.else);
        if (step.thenEnd && step.elseEnd) ended = true;
      }
    }
  };
  walk(steps);
  return found;
}

export interface ValidationScope {
  // A template of the Home library names roles only; a project workflow may name one of
  // the project's agents or members directly.
  template: boolean;
}

// Reads and checks a definition as a client sent it. `definition` is null when the
// input is not usable at all; the issues say what to fix.
export function validateDefinition(
  raw: unknown,
  scope: ValidationScope,
): { definition: PipelineDefinition | null; issues: DefinitionIssue[] } {
  const value = record(raw);
  if (!value || value.schemaVersion !== 1)
    return {
      definition: null,
      issues: [{ code: 'invalid', stepId: null, field: 'schemaVersion' }],
    };
  const issues: DefinitionIssue[] = [];
  const triggerReader = new Reader(null);
  const trigger = readTrigger(value.trigger, triggerReader);
  issues.push(...triggerReader.issues);
  const rawRoles = Array.isArray(value.roles) ? value.roles : [];
  if (rawRoles.length > LIMITS.roles)
    issues.push({ code: 'too_many', stepId: null, field: 'roles', params: { max: LIMITS.roles } });
  const roles = rawRoles.map((role, index) => readRole(role, index, issues));
  const counter = { count: 0 };
  const steps = readSteps(value.steps, 1, issues, counter);
  const definition: PipelineDefinition = { schemaVersion: 1, trigger, roles, steps };

  if (steps.length === 0) issues.push({ code: 'no_steps', stepId: null, field: 'steps' });
  if (counter.count > LIMITS.steps)
    issues.push({ code: 'too_many', stepId: null, field: 'steps', params: { max: LIMITS.steps } });

  const roleKeys = new Set<string>();
  for (const role of roles) {
    if (roleKeys.has(role.key))
      issues.push({ code: 'duplicate_role_key', stepId: null, field: `roles.${role.key}.key` });
    roleKeys.add(role.key);
  }

  const flat = flattenSteps(steps);
  const ids = new Set<string>();
  for (const { step } of flat) {
    if (ids.has(step.id)) issues.push({ code: 'duplicate_step_id', stepId: step.id, field: 'id' });
    ids.add(step.id);
  }

  const checkRole = (stepId: string, field: string, assignee: { role: string } | object) => {
    if ('role' in assignee && !roleKeys.has(assignee.role))
      issues.push({ code: 'unknown_role', stepId, field, params: { role: assignee.role } });
  };
  for (const entry of flat) {
    const { step } = entry;
    if (step.type === 'agent') {
      checkRole(step.id, 'assignee', step.assignee);
      if ('agentId' in step.assignee && scope.template)
        issues.push({ code: 'agent_in_template', stepId: step.id, field: 'assignee' });
    }
    if (step.type === 'action' && step.action.kind === 'set_assignee' && step.action.assignee) {
      checkRole(step.id, 'action.assignee', step.action.assignee);
      if ('userId' in step.action.assignee && scope.template)
        issues.push({ code: 'member_in_template', stepId: step.id, field: 'action.assignee' });
    }
    if (step.type === 'approval' && step.onReject.action === 'goto') {
      const target = step.onReject.stepId;
      if (!entry.path.some((before) => before.id === target))
        issues.push({ code: 'invalid_rework_target', stepId: step.id, field: 'onReject.stepId' });
    }
    checkVariables(entry, ids, issues);
  }
  for (const step of unreachable(steps))
    issues.push({ code: 'unreachable_step', stepId: step.id, field: null });
  return { definition, issues };
}

const MESSAGES: Record<string, string> = {
  invalid: 'The value is invalid',
  required: 'The value is required',
  too_long: 'The value is too long',
  too_many: 'There are too many entries',
  out_of_range: 'The value is out of range',
  too_deep: 'Conditions are nested too deeply',
  invalid_cron: 'The cron expression is invalid',
  invalid_timezone: 'The time zone is invalid',
  no_steps: 'The workflow has no steps',
  duplicate_role_key: 'Two roles share a key',
  duplicate_step_id: 'Two steps share an id',
  unknown_role: 'The role is not defined',
  agent_in_template: 'A template names roles, not agents',
  member_in_template: 'A template cannot name a member',
  invalid_rework_target: 'The rework step must come before this approval on its path',
  unknown_variable: 'The variable does not exist',
  unknown_step_variable: 'The variable names a step that does not exist',
  step_variable_not_before: 'The variable names a step that does not come before this one',
  no_previous_step: 'No step before this one leaves a result',
  unreachable_step: 'No run reaches this step',
  role_unresolved: 'No agent of the project fills this role',
  agent_not_in_project: 'The agent does not work in this project',
  member_not_in_project: 'The member is not in this project',
  unknown_status: 'The project has no status of this name',
  unknown_label: 'The project has no label of this name',
  unknown_area: 'The project has no area of this name',
  model_not_allowed: 'No agent of the team runs this model',
  schedule_too_frequent: 'The schedule runs more often than the team allows',
};

export function issueMessage(issue: DefinitionIssue): string {
  const text = MESSAGES[issue.code] ?? issue.code;
  const where = [issue.stepId && `step ${issue.stepId}`, issue.field].filter(Boolean).join(', ');
  return where ? `${text} (${where})` : text;
}
