import { maxTurnsLimit, runBudgetSecondsLimit } from '#modules/agents/model';
import { registerBuiltins } from '#modules/engine/builtin/index';
import { stepType, triggerType } from '#modules/engine/registry';
import type {
  ActionCategory,
  DefinitionIssue,
  FieldReader,
  ReadScope,
  StepDefinition,
  TriggerDefinition,
} from '#modules/engine/sdk';

export type { DefinitionIssue } from '#modules/engine/sdk';

// A workflow definition: a trigger, the roles its agent steps name, and an ordered list
// of steps. A condition step holds two lanes of steps, one for each answer; after its
// lane the run continues with the step after the condition, or ends when the lane says
// so. The Helena engine interprets the definition a run pinned. Step and trigger types
// come from the engine's registries (modules/engine/registry.ts): the types below are
// the built-in ones, and a plugin adds its own without changing this file.

export const BUILTIN_STEP_KINDS = [
  'agent',
  'approval',
  'condition',
  'action',
  'wait',
  'notify',
  'webhook',
  'delegate',
  'agent_team',
] as const;
export type StepKind = (typeof BUILTIN_STEP_KINDS)[number];

export type PipelineTrigger =
  | { type: 'manual' | 'task_created' | 'task_assigned' }
  // `to` is a status name; null fires on every change.
  | { type: 'status_changed'; to: string | null }
  | { type: 'label_added'; label: string }
  // Every fire creates a task with `title` and runs the workflow on it.
  | { type: 'schedule'; cron: string; timezone: string; title: string }
  // Every request to the workflow's hook creates a task with `title` (the request's own
  // `title` field when it has one) and runs the workflow on it.
  | { type: 'webhook'; title: string }
  // Every new mail that matches creates a task with the mail's subject and runs the
  // workflow on it. Empty filters match every mail of the project's accounts.
  | { type: 'mail_received'; from: string; subject: string }
  // Built-in workflows only: a task delegated to a coordinator (agent team), a routine.
  | { type: 'delegation' | 'routine' };

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
  // A step type may carry fields of its own (engine/sdk.ts StepDefinition).
  [field: string]: unknown;
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
  // What the step lets through, for the policy engine (autopilot) to decide whether a
  // person has to approve it. 'publish' when left out.
  category?: ActionCategory;
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

// Tells people about the run: a comment on the task that mentions them, which reaches
// their inbox and their email or Telegram like any mention.
export interface NotifyStep extends StepBase {
  type: 'notify';
  to: { kind: 'assignee' } | { kind: 'watchers' } | { kind: 'members'; userIds: string[] };
  message: string;
}

// Sends the task and the results so far to a URL, signed per Standard Webhooks with the
// project's signing secret. The answer's status decides the outcome.
export interface WebhookStep extends StepBase {
  type: 'webhook';
  url: string;
  // Extra text sent along as `message`, with variables.
  message: string;
}

// A routine's work: creates a task for the agent, or reopens the named one, unless the
// routine's task is still open. Only routines use it.
export interface DelegateStep extends StepBase {
  type: 'delegate';
  agentId: number;
  title: string;
  instructions: string;
  mode: 'new' | 'reopen';
  taskId: number | null;
}

// The agent team of a task: the coordinator plans, specialists work in dependency order,
// the coordinator reviews, and the result goes to the task. Only the engine creates it,
// for a task delegated to a coordinator.
export interface AgentTeamStep extends StepBase {
  type: 'agent_team';
  team: Record<string, unknown>;
}

export type PipelineStep =
  | AgentStep
  | ApprovalStep
  | ConditionStep
  | ActionStep
  | WaitStep
  | NotifyStep
  | WebhookStep
  | DelegateStep
  | AgentTeamStep;

export interface PipelineDefinition {
  schemaVersion: 1;
  trigger: PipelineTrigger;
  roles: PipelineRole[];
  steps: PipelineStep[];
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

export const STEP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROLE_KEY = /^[a-z][a-z0-9-]{0,31}$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const OUTCOMES = ['success', 'failed', 'blocked'] as const;
export const TASK_FIELDS = ['status', 'statusType', 'labels', 'area', 'priority'] as const;
export const DATE_FIELDS = ['dueDate', 'startDate'] as const;
const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const TASK_VARIABLES = new Set(['title', 'description', 'identifier', 'status']);
const RESULT_VARIABLES = new Set(['summary', 'outcome', 'note']);

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

// Reads the fields of one step, trigger or role and records what is wrong with them.
export class Reader implements FieldReader {
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

// The trigger types a client may choose in the builder; `delegation` and `routine` start
// the built-in workflows of an agent team and a routine only.
const ENGINE_ONLY_TRIGGERS = new Set(['delegation', 'routine']);

function readTrigger(raw: unknown, reader: Reader, scope: DefinitionScope): PipelineTrigger {
  registerBuiltins();
  const value = record(raw) ?? {};
  const name = typeof value.type === 'string' ? value.type : '';
  const type = triggerType(name);
  if (!type || (ENGINE_ONLY_TRIGGERS.has(name) && !scope.engine)) {
    reader.issue('invalid', 'trigger.type');
    return { type: 'manual' };
  }
  const prefixed = new Reader(null, 'trigger.');
  const fields = type.read(value, prefixed);
  reader.issues.push(...prefixed.issues);
  return { ...fields, type: name } as PipelineTrigger;
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

interface DefinitionScope extends ReadScope {
  // A definition the engine builds itself (an agent team, a routine) may use the types
  // a client may not.
  engine?: boolean;
}

function readSteps(
  raw: unknown,
  depth: number,
  issues: DefinitionIssue[],
  counter: { count: number },
  scope: DefinitionScope,
): PipelineStep[] {
  if (!Array.isArray(raw)) {
    issues.push({ code: 'invalid', stepId: null, field: 'steps' });
    return [];
  }
  return raw.map((item) => readStep(item, depth, issues, counter, scope));
}

// Reads one step: the engine reads its id, name, type and, for a type with lanes, the
// lanes; the step type reads the rest.
function readStep(
  raw: unknown,
  depth: number,
  issues: DefinitionIssue[],
  counter: { count: number },
  scope: DefinitionScope,
): PipelineStep {
  counter.count += 1;
  const value = record(raw) ?? {};
  const id = typeof value.id === 'string' ? value.id : '';
  const reader = new Reader(id || null);
  if (!STEP_ID.test(id)) reader.issue('invalid', 'id');
  const name = reader.text(value.name, 'name', LIMITS.name);
  const typeName = typeof value.type === 'string' ? value.type : '';
  const type = stepType(typeName);
  if (!type || (!type.ui.builder && !scope.engine)) {
    reader.issue('invalid', 'type');
    issues.push(...reader.issues);
    return { id, name, type: 'wait', wait: { kind: 'delay', minutes: 1 } };
  }
  const fields = type.read(value, reader, scope) as Record<string, unknown>;
  let step = { ...fields, id, name, type: typeName } as unknown as PipelineStep;
  if (type.branching) {
    if (depth > LIMITS.depth) reader.issue('too_deep', null, { max: LIMITS.depth });
    step = {
      ...step,
      then: readSteps(value.then ?? [], depth + 1, issues, counter, scope),
      else: readSteps(value.else ?? [], depth + 1, issues, counter, scope),
      thenEnd: value.thenEnd === true,
      elseEnd: value.elseEnd === true,
    } as PipelineStep;
  }
  issues.push(...reader.issues);
  return step;
}

// The lanes of a step that has them (a condition).
export function lanesOf(step: StepDefinition): StepDefinition[][] {
  return Array.isArray(step.then) || Array.isArray(step.else)
    ? [step.then ?? [], step.else ?? []]
    : [];
}

// Every step in document order: the order a reader sees them, a condition before the
// steps of its lanes. `path` are the steps a run passed through to reach the step: the
// earlier steps of its lane and of every lane around it, the conditions around it
// (`ancestors`) included.
export interface FlatStep {
  step: PipelineStep;
  index: number;
  path: PipelineStep[];
  ancestors: PipelineStep[];
}

export function flattenSteps(steps: StepDefinition[]): FlatStep[] {
  const flat: FlatStep[] = [];
  const walk = (lane: StepDefinition[], before: StepDefinition[], ancestors: StepDefinition[]) => {
    lane.forEach((step, position) => {
      const path = [...before, ...lane.slice(0, position)];
      flat.push({
        step: step as PipelineStep,
        index: flat.length,
        path: path as PipelineStep[],
        ancestors: ancestors as PipelineStep[],
      });
      for (const inner of lanesOf(step)) walk(inner, [...path, step], [...ancestors, step]);
    });
  };
  walk(steps, [], []);
  return flat;
}

export function findStep(steps: StepDefinition[], id: string): PipelineStep | undefined {
  return flattenSteps(steps).find((entry) => entry.step.id === id)?.step;
}

function descendants(step: StepDefinition): StepDefinition[] {
  return lanesOf(step)
    .flat()
    .flatMap((child) => [child, ...descendants(child)]);
}

// The steps a run may have executed before it reaches the step: its path, and the
// lanes of the earlier conditions on it.
export function stepsBefore(entry: FlatStep): StepDefinition[] {
  return entry.path.flatMap((step) =>
    lanesOf(step).length > 0 && !entry.ancestors.includes(step)
      ? [step, ...descendants(step)]
      : [step],
  );
}

// The {{…}} variables of a text, as written between the braces.
export function variablesIn(text: string): string[] {
  return [...text.matchAll(VARIABLE)].map((match) => match[1]);
}

// The fields of a step whose text may hold variables.
export function templateFields(step: StepDefinition): { field: string; text: string }[] {
  registerBuiltins();
  return stepType(step.type)?.templateFields?.(step) ?? [];
}

// A step that leaves a result the next steps read as `previous`. A condition and a wait
// only decide where and when the run goes on.
export function producesResult(step: StepDefinition): boolean {
  registerBuiltins();
  return stepType(step.type)?.producesResult === true;
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
function unreachable(steps: StepDefinition[]): StepDefinition[] {
  const found: StepDefinition[] = [];
  const walk = (lane: StepDefinition[]) => {
    let ended = false;
    for (const step of lane) {
      if (ended) found.push(step);
      for (const inner of lanesOf(step)) walk(inner);
      if (lanesOf(step).length > 0 && step.thenEnd && step.elseEnd) ended = true;
    }
  };
  walk(steps);
  return found;
}

export type ValidationScope = DefinitionScope;

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
  const trigger = readTrigger(value.trigger, triggerReader, scope);
  issues.push(...triggerReader.issues);
  const rawRoles = Array.isArray(value.roles) ? value.roles : [];
  if (rawRoles.length > LIMITS.roles)
    issues.push({ code: 'too_many', stepId: null, field: 'roles', params: { max: LIMITS.roles } });
  const roles = rawRoles.map((role, index) => readRole(role, index, issues));
  const counter = { count: 0 };
  const steps = readSteps(value.steps, 1, issues, counter, scope);
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

  for (const entry of flat) {
    const { step } = entry;
    const type = stepType(step.type);
    for (const reference of type?.roleReferences?.(step) ?? [])
      if (!roleKeys.has(reference.role))
        issues.push({
          code: 'unknown_role',
          stepId: step.id,
          field: reference.field,
          params: { role: reference.role },
        });
    issues.push(...(type?.checkDefinition?.(step, entry.path) ?? []));
    checkVariables(entry, ids, issues);
  }
  for (const step of unreachable(steps))
    issues.push({ code: 'unreachable_step', stepId: step.id, field: null });
  return { definition, issues };
}

// The definition of a trigger as a type sees it.
export function triggerOf(definition: PipelineDefinition): TriggerDefinition {
  return definition.trigger as TriggerDefinition;
}

export { maxTurnsLimit, runBudgetSecondsLimit };

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
