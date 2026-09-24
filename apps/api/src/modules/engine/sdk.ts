// The extension points of the Helena engine: step types, trigger types, domain events and
// the policy seam. Built-in types register through exactly these interfaces
// (builtin/index.ts), so a plugin adds a step or a trigger without touching the engine.
// The shapes are kept free of Helena internals so they can move into `@helena/sdk`
// (hub/framework) unchanged; until then they live here.

// ---- domain events -----------------------------------------------------------------

// A domain event in the CloudEvents 1.0 shape. `type` is reverse-DNS-like
// (`helena.task.created`), `subject` names the thing it is about (`task:KEY-12`), and
// `helenaproject` is a CloudEvents extension attribute carrying the project id.
export interface DomainEvent<D extends Record<string, unknown> = Record<string, unknown>> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject?: string;
  time: string;
  helenaproject?: number;
  data: D;
}

// ---- definitions ---------------------------------------------------------------------

// A step as a workflow definition stores it. The engine reads `id`, `name` and `type`
// and, for a step with lanes (a condition), `then`, `else`, `thenEnd` and `elseEnd`;
// every other field belongs to the step type.
export interface StepDefinition {
  id: string;
  name: string;
  type: string;
  then?: StepDefinition[];
  else?: StepDefinition[];
  thenEnd?: boolean;
  elseEnd?: boolean;
  [field: string]: unknown;
}

export interface TriggerDefinition {
  type: string;
  [field: string]: unknown;
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  trigger: TriggerDefinition;
  roles: { key: string; name: string; match: Record<string, unknown> }[];
  steps: StepDefinition[];
}

// A problem of a definition, as the builder shows it next to the field.
export interface DefinitionIssue {
  code: string;
  // The step the issue belongs to; null for the trigger, the roles or the whole list.
  stepId: string | null;
  // The field of the step, trigger or role, e.g. 'instruction' or 'roles.coder.name'.
  field: string | null;
  params?: Record<string, string | number>;
}

// Reads the fields of one step or trigger of a definition a client sent, recording what
// is wrong instead of throwing. Field names are relative to the step or trigger.
export interface FieldReader {
  issue(code: string, field: string | null, params?: DefinitionIssue['params']): void;
  text(value: unknown, field: string, max: number, required?: boolean): string;
  integer(value: unknown, field: string, limit: { minimum: number; maximum: number }): number;
  optionalInteger(
    value: unknown,
    field: string,
    limit: { minimum: number; maximum: number },
  ): number | null;
  choice<T extends string>(value: unknown, field: string, options: readonly T[]): T;
  names(value: unknown, field: string): string[];
}

export interface ReadScope {
  // A template of the Home library names roles only; a project workflow may name one of
  // the project's agents or members directly.
  template: boolean;
}

// ---- execution -----------------------------------------------------------------------

export interface RunInfo {
  id: string;
  kind: 'workflow' | 'agent_team' | 'routine';
  project: { id: number; key: string; name: string; teamId: number };
  // The task the run works on; null until a step creates it (a routine that creates one).
  taskId: number | null;
  dryRun: boolean;
  trigger: string;
  actorUserId: string | null;
  // The workflow's name, or the routine's title.
  name: string;
  version: number | null;
  scheduleId: string | null;
  scheduledFor: string | null;
  // Role key → agent id, as the project maps the workflow's roles.
  roles: Record<string, number>;
}

// One execution of a step: a step a rework loop reaches again executes again with the
// next `iteration`; `seq` counts the executions of the run.
export interface StepExecution {
  stepId: string;
  iteration: number;
  seq: number;
}

// What a step type can do while it executes. Everything that reads or writes the world
// happens inside `op`, whose result is recorded, so a run continued after a restart or
// deploy replays the step to where it was instead of doing anything twice.
export interface StepContext<S extends StepDefinition = StepDefinition> {
  readonly run: RunInfo;
  readonly step: S;
  readonly execution: StepExecution;
  // The attempt of this execution: "Erneut versuchen" on a failed run executes the failed
  // step again with the next attempt.
  readonly attempt: number;
  readonly definition: WorkflowDefinition;
  // A durable operation. `name` must be the same on every replay of this execution.
  op<T>(name: string, fn: () => Promise<T>): Promise<T>;
  // Sleeps durably until the time; a continued run sleeps what is left.
  sleepUntil(at: Date): Promise<void>;
  // Waits durably for a signal on the topic, at most `timeoutSeconds`. Signals are a
  // wake-up call, not the source of truth: the step reads what changed in an op.
  waitForSignal<T>(topic: string, timeoutSeconds: number): Promise<T | null>;
}

// How a step went, which decides where the run goes next.
export type StepResult =
  // The usual way: the next step of the lane. An outcome 'failed' or 'blocked' ends the
  // run unless the next step is a condition on the outcome.
  | { kind: 'continue'; outcome?: string; summary?: string }
  // A condition: the engine takes the lane of the answer.
  | { kind: 'branch'; matched: boolean }
  // Back to an earlier step (a rework loop).
  | { kind: 'goto'; stepId: string }
  // The run ends here.
  | { kind: 'end'; status: 'succeeded' | 'rejected' | 'skipped'; result?: unknown };

// A step that cannot go on: the run fails with the message, and "Erneut versuchen"
// executes the step again as a new attempt. Anything else a step throws counts the same.
export class StepFailure extends Error {
  constructor(
    message: string,
    readonly outcome: string = 'failed',
  ) {
    super(message);
    this.name = 'StepFailure';
  }
}

export interface StepTypeUi {
  // Offered in the builder's "add step" menu. Built-in structural types that only the
  // engine creates (the agent team of a task, a routine's delegation) are not.
  builder: boolean;
  // lucide icon name for the builder.
  icon?: string;
}

// A step type: how the builder reads and checks it, and how the engine executes it.
export interface WorkflowStepType<S extends StepDefinition = StepDefinition> {
  type: string;
  ui: StepTypeUi;
  // A step with two lanes of steps, `then` and `else` (a condition): the engine reads the
  // lanes, and `execute` answers with `branch`.
  branching?: boolean;
  // Reads the type's own fields of a step a client sent (`id`, `name`, `type` and a
  // condition's lanes are read by the engine).
  read(
    raw: Record<string, unknown>,
    reader: FieldReader,
    scope: ReadScope,
  ): Omit<S, 'id' | 'name' | 'type'>;
  // Text fields that may hold {{variables}}.
  templateFields?(step: S): { field: string; text: string }[];
  // Whether the step leaves a result later steps read as `previous`.
  producesResult?: boolean;
  // The roles the step names, so the builder can check them against the workflow's roles.
  roleReferences?(step: S): { field: string; role: string }[];
  // Checks that apply to the whole definition (e.g. a rework target on the step's path).
  checkDefinition?(step: S, path: StepDefinition[]): DefinitionIssue[];
  execute(context: StepContext<S>): Promise<StepResult>;
  // Called outside the run when a person cancels it while this step executes, to stop
  // what the step started (an agent run).
  cancel?(runId: string, execution: StepExecution): Promise<void>;
}

// What a trigger that listens to domain events decides for one event.
export interface TriggerMatch {
  // The task the run works on; null when the run creates one first (`input.task`).
  taskId: number | null;
  // What the run gets from the event: `{ task: { title, description } }` for a task it
  // creates, and whatever else later steps may read.
  input?: Record<string, unknown>;
}

export interface WorkflowTriggerType<T extends TriggerDefinition = TriggerDefinition> {
  type: string;
  // Reads the trigger's own fields.
  read(raw: Record<string, unknown>, reader: FieldReader): Omit<T, 'type'>;
  // The domain event types that can start a run of a workflow with this trigger.
  events?: string[];
  // Whether one event starts a run of the workflow, and on which task. Called for the
  // enabled workflows of the event's project.
  match?(trigger: T, event: DomainEvent): Promise<TriggerMatch | null>;
  // A time-based trigger: the cron it fires on.
  schedule?(trigger: T): { cron: string; timezone: string } | null;
}

// ---- policy --------------------------------------------------------------------------

// The categories an action falls into, after the MCP tool annotations (read, write,
// send, delete, pay, publish) plus 'run' for starting an agent and 'approve' for a
// workflow's approval gate.
export type ActionCategory =
  'read' | 'write' | 'send' | 'delete' | 'pay' | 'publish' | 'run' | 'approve';

// The policy engine's answer: go ahead, ask a person first, or refuse (with why).
export type PolicyDecision =
  | { decision: 'allow'; reason?: string }
  | { decision: 'ask'; reason?: string }
  | { decision: 'deny'; reason: string };

// "May this agent do this here?" — answered centrally by the autopilot (hub/autopilot).
export interface PolicyDecider {
  decide(input: {
    agentId: number | null;
    projectId: number;
    actionCategory: ActionCategory;
    // The task the action is about, when there is one.
    taskId?: number | null;
    // What is asked about, for the audit and a person deciding.
    subject?: string;
  }): Promise<PolicyDecision>;
}
