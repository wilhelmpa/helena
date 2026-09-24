import type { ActionCategory } from './actions';
import type { Logger, ProjectRef } from './common';
import type { HelenaEvent } from './events';
import type { SchemaLike } from './schema';
import type { LocalizedText } from './text';

// Workflow step types and trigger types. The engine that runs workflows (the worker)
// owns the run state, leases, retries and resume; a step type only says what its
// configuration is, checks it, and does one step when the engine asks. A trigger type
// says when a workflow starts: on a domain event, on a schedule, or both.

export interface StepIssue {
  // A stable code the builder translates, e.g. "unknown_agent".
  code: string;
  // The config field the issue is about.
  field?: string;
  message?: string;
}

export interface StepValidationContext {
  project: ProjectRef | null;
  // Ids of the steps before this one, for a config that references an earlier result.
  previousSteps: string[];
}

export interface StepRun {
  // The run's id (a workflow run, an agent team or a routine fire).
  id: string;
  // The builder workflow the run belongs to; null for an agent team or a routine.
  workflowId: number | null;
  project: ProjectRef | null;
  issueId?: number | null;
  // A test run: a step that acts on the world should say what it would do instead.
  dryRun?: boolean;
}

export interface StepExecutionContext<Config> {
  config: Config;
  run: StepRun;
  step: { id: string; name: string };
  // What earlier steps produced and the trigger carried, for templates and conditions.
  input: Record<string, unknown>;
  // 1 on the first attempt.
  attempt: number;
  signal: AbortSignal;
  log: Logger;
}

// A step either finishes, waits, or fails. Waiting is how a step outlives the process:
// the engine stores the run, and wakes it at `until` or when the signal arrives. Then
// `resume` is called. Signal keys: `approval` an approval request's id (woken when it is
// decided), `run` an agent run's id (woken when it finishes or fails), `event` a domain
// event type, or `<type>@<subject>` for one subject (woken by the next such event, whose
// data the signal carries). `execute` may run again when the process stops while it runs,
// so a step that acts on the world should make its action idempotent.
export type StepOutcome =
  | { status: 'completed'; output?: Record<string, unknown>; next?: string }
  | {
      status: 'waiting';
      until?: string;
      signal?: { kind: 'approval' | 'run' | 'event'; key: string };
      output?: Record<string, unknown>;
    }
  | { status: 'failed'; error: string; retryable?: boolean };

export interface StepSignal {
  kind: 'approval' | 'run' | 'event' | 'timer';
  key: string;
  data?: Record<string, unknown>;
}

// Hints for the builder. A step without a form of its own gets a form generated from its
// configSchema; `form` names a built-in form component instead.
export interface StepUiHints {
  group?: string;
  color?: string;
  form?: string;
  // The config fields shown on the step's card in the canvas.
  summaryFields?: string[];
}

export interface WorkflowStepType<Config = unknown> {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  icon?: string;
  // What running the step does, for the policy: an agent task `execute`, a mail step
  // `send`, a condition `read`.
  category: ActionCategory;
  configSchema: SchemaLike<Config>;
  defaults?: () => Config;
  // The result fields later steps can reference as {{step.<id>.<field>}}.
  outputs?: string[];
  ui?: StepUiHints;
  validate?(config: Config, ctx: StepValidationContext): StepIssue[] | Promise<StepIssue[]>;
  execute(ctx: StepExecutionContext<Config>): Promise<StepOutcome>;
  resume?(ctx: StepExecutionContext<Config>, signal: StepSignal): Promise<StepOutcome>;
}

export interface TriggerMatch {
  // Variables the trigger hands to the run ({{trigger.<name>}}).
  vars?: Record<string, unknown>;
  issueId?: number | null;
}

export interface TriggerType<Config = unknown> {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  icon?: string;
  configSchema: SchemaLike<Config>;
  defaults?: () => Config;
  // Event-driven: the domain event types (CloudEvents `type`) the trigger listens to, and
  // whether one of them starts a run with this config.
  events?: string[];
  match?(config: Config, event: HelenaEvent): TriggerMatch | null | Promise<TriggerMatch | null>;
  // Time-driven: the next time after `after` the trigger fires, or null when it no
  // longer does.
  next?(config: Config, after: Date): Date | null;
  // A sentence for the list view: "jeden Montag um 9:00".
  describe?(config: Config, locale: string): string;
}
