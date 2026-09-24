import {
  consoleLogger,
  isStandardSchema,
  matchesEventPattern,
  SchemaError,
  toJsonSchema,
  validate,
  type HelenaEvent,
  type StepExecutionContext,
  type StepOutcome,
  type StepSignal,
  type TriggerType as SdkTriggerType,
  type WorkflowStepType as SdkStepType,
} from '@helena/sdk';
import { agentRun, approvalRequest, db, pipelineRunStep } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { registries } from '#shared/helena';
import { renderTemplate } from '#modules/pipelines/render';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { engineWaitSeconds } from './dbos';
import { clip, loadRun, renderContext, setRunStatus, stepRow, writeStep } from './run-context';
import { signalRun } from './runs';
import {
  type DomainEvent,
  type FieldReader,
  type PluginTypeInfo,
  type StepContext,
  type StepDefinition,
  type StepExecution,
  type StepResult,
  type TriggerDefinition,
  type WorkflowStepType,
  type WorkflowTriggerType,
} from './sdk';

// Plugins' step and trigger types in the engine. A plugin registers them in the framework's
// shape (@helena/sdk `WorkflowStepType` / `TriggerType`, through the plugin host into
// `registries.stepTypes` / `registries.triggerTypes`); the engine adapts each one to its own
// interface, so the builder lists and checks them and the interpreter runs them like the
// built-in types:
//
// - a step stores its configuration under `config`, checked against the type's
//   `configSchema` and `validate`; its text fields may hold {{variables}}, filled in before
//   `execute`;
// - `execute` runs as a recorded operation; `completed` goes on (its `output` fields are
//   `{{step.<id>.<field>}}` for later steps, `next` jumps to a step), `failed` is the
//   outcome `failed` an outcome condition can branch on, `waiting` stores the run until
//   `until` or the signal, and then `resume` is called;
// - a test run executes a step of category `read` and records every other one as
//   simulated;
// - the policy host is asked before every execution, like for a built-in step (the
//   interpreter does that, workflows.ts).
//
// A plugin's type id must be namespaced (`<plugin>.<name>`): the engine's own names have no
// dot, so neither can hide the other.

export function isPluginTypeName(name: string): boolean {
  return name.includes('.');
}

// ---- configuration --------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function schemaOf(schema: unknown): Record<string, unknown> {
  try {
    return toJsonSchema(schema as never);
  } catch {
    return { type: 'object' };
  }
}

// Checks a configuration where the schema checks synchronously (Zod does); a schema that
// validates asynchronously is checked when the step executes. Answers the parsed value.
function checkConfig(
  schema: unknown,
  value: Record<string, unknown>,
  reader: FieldReader,
): Record<string, unknown> {
  if (!isStandardSchema(schema)) return value;
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) return value;
  if (result.issues) {
    for (const issue of result.issues) {
      const path = (issue.path ?? [])
        .map((part) =>
          typeof part === 'object' && part !== null ? String(part.key) : String(part),
        )
        .join('.');
      reader.issue('plugin_invalid', path ? `config.${path}` : 'config', {
        message: clip(issue.message, 200),
      });
    }
    return value;
  }
  return record(result.value) ?? value;
}

// The text leaves of a configuration, which may hold {{variables}}.
function textLeaves(value: unknown, path: string[] = []): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path: path.join('.'), text: value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => textLeaves(item, [...path, String(index)]));
  const object = record(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, item]) => textLeaves(item, [...path, key]));
}

function mapTexts(value: unknown, fill: (text: string) => string): unknown {
  if (typeof value === 'string') return fill(value);
  if (Array.isArray(value)) return value.map((item) => mapTexts(item, fill));
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [key, mapTexts(item, fill)]),
  );
}

function info(
  pluginId: string,
  type: {
    label: PluginTypeInfo['label'];
    description?: PluginTypeInfo['label'];
    configSchema: unknown;
    defaults?: () => unknown;
  },
  category: PluginTypeInfo['category'],
  outputs: string[],
): PluginTypeInfo {
  let defaults: Record<string, unknown> = {};
  try {
    defaults = record(type.defaults?.()) ?? {};
  } catch {
    defaults = {};
  }
  return {
    pluginId,
    label: type.label,
    description: type.description ?? null,
    category,
    configSchema: schemaOf(type.configSchema),
    defaults,
    outputs,
  };
}

// ---- steps ----------------------------------------------------------------------------

interface PluginStep extends StepDefinition {
  config: Record<string, unknown>;
}

// What a waiting execution waits for, on its row (`state.wait`); the wake-up subscriber
// finds it by `key`.
interface PluginWait {
  kind: 'approval' | 'run' | 'event' | 'timer';
  key: string;
  until: string | null;
}

interface PluginState {
  wait?: PluginWait;
  output?: Record<string, unknown>;
}

// The outcome of one call of the type, as the operation records it.
type Recorded =
  | { status: 'completed'; output: Record<string, unknown>; next: string | null; summary: string }
  | { status: 'failed'; error: string }
  | { status: 'waiting'; wait: PluginWait };

function waitTopic(at: { stepId: string; iteration: number }): string {
  return `wait:${at.stepId}#${at.iteration}`;
}

function summaryOf(output: Record<string, unknown>): string {
  const texts = Object.values(output).filter((value): value is string => typeof value === 'string');
  if (texts.length > 0) return clip(texts.join('\n'));
  return Object.keys(output).length > 0 ? clip(JSON.stringify(output)) : '';
}

async function executionContext(
  sdk: SdkStepType<unknown>,
  runId: string,
  step: PluginStep,
  at: StepExecution,
  attempt: number,
) {
  const context = await loadRun(runId);
  const variables = await renderContext(context, at.seq);
  const filled = mapTexts(step.config, (text) => renderTemplate(text, variables));
  const config = await validate(sdk.configSchema, filled);
  const steps = Object.fromEntries(
    Object.entries(variables.steps).map(([id, result]) => [
      id,
      { summary: result.summary, outcome: result.outcome, note: result.note, ...result.output },
    ]),
  );
  const input = (context.run.input ?? {}) as Record<string, unknown>;
  const ctx: StepExecutionContext<unknown> = {
    config,
    run: {
      id: runId,
      workflowId: context.run.pipelineId,
      project: {
        id: context.project.id,
        key: context.project.key,
        teamId: context.project.teamId,
      },
      issueId: context.run.issueId,
      dryRun: context.run.dryRun,
    },
    step: { id: step.id, name: step.name },
    input: {
      task: variables.task,
      previous: variables.previous,
      steps,
      trigger: record(input.trigger) ?? {},
    },
    attempt,
    signal: AbortSignal.timeout(15 * 60_000),
    log: consoleLogger(`step ${sdk.id}`),
  };
  return { context, ctx };
}

// Records what the type answered on the execution's row.
async function recordOutcome(
  runId: string,
  step: PluginStep,
  at: StepExecution,
  outcome: StepOutcome,
  projectId: number,
): Promise<Recorded> {
  let recorded: Recorded;
  if (outcome.status === 'completed') {
    const output = record(outcome.output) ?? {};
    const summary = summaryOf(output);
    await writeStep(runId, step, at, {
      status: 'succeeded',
      outcome: 'success',
      summary,
      state: { output } satisfies PluginState,
      finishedAt: new Date(),
    });
    recorded = { status: 'completed', output, next: outcome.next ?? null, summary };
  } else if (outcome.status === 'waiting') {
    const wait: PluginWait = outcome.signal
      ? {
          kind: outcome.signal.kind,
          key: String(outcome.signal.key),
          until: outcome.until ?? null,
        }
      : { kind: 'timer', key: '', until: outcome.until ?? new Date().toISOString() };
    await writeStep(runId, step, at, {
      status: 'waiting',
      state: { wait, output: record(outcome.output) ?? {} } satisfies PluginState,
    });
    await setRunStatus(runId, 'waiting');
    recorded = { status: 'waiting', wait };
  } else {
    const error = clip(outcome.error || 'The step failed', 2_000);
    await writeStep(runId, step, at, {
      status: 'failed',
      outcome: 'failed',
      summary: error,
      error,
      finishedAt: new Date(),
    });
    recorded = { status: 'failed', error };
  }
  await bumpControlPlaneRevision(projectId);
  return recorded;
}

function failure(error: unknown): StepOutcome {
  return {
    status: 'failed',
    error:
      error instanceof SchemaError
        ? `The step's configuration is invalid: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

// The first call of the type for an execution. An execution that already has its answer
// (a replay after the process stopped inside this operation) is not run again.
async function start(
  sdk: SdkStepType<unknown>,
  runId: string,
  step: PluginStep,
  at: StepExecution,
  attempt: number,
): Promise<Recorded> {
  const existing = await stepRow(runId, at);
  if (existing?.status === 'succeeded' || existing?.status === 'simulated') {
    const output = (existing.state as PluginState | null)?.output ?? {};
    return { status: 'completed', output, next: null, summary: existing.summary ?? '' };
  }
  if (existing?.status === 'waiting') {
    const wait = (existing.state as PluginState | null)?.wait;
    if (wait) return { status: 'waiting', wait };
  }
  let prepared: Awaited<ReturnType<typeof executionContext>>;
  try {
    prepared = await executionContext(sdk, runId, step, at, attempt);
  } catch (error) {
    const context = await loadRun(runId);
    return recordOutcome(runId, step, at, failure(error), context.project.id);
  }
  const { context, ctx } = prepared;
  if (context.run.dryRun && sdk.category !== 'read') {
    const summary = `${sdk.id}: ${clip(JSON.stringify(ctx.config), 500)}`;
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    });
    return { status: 'completed', output: {}, next: null, summary };
  }
  let outcome: StepOutcome;
  try {
    outcome = await sdk.execute(ctx);
  } catch (error) {
    outcome = failure(error);
  }
  return recordOutcome(runId, step, at, outcome, context.project.id);
}

// Called when the wait is over: `resume` with the signal, or, for a type without one, the
// step completes with what it stored when it began to wait.
async function resume(
  sdk: SdkStepType<unknown>,
  runId: string,
  step: PluginStep,
  at: StepExecution,
  attempt: number,
  signal: StepSignal,
): Promise<Recorded> {
  const existing = await stepRow(runId, at);
  if (existing?.status === 'succeeded') {
    const output = (existing.state as PluginState | null)?.output ?? {};
    return { status: 'completed', output, next: null, summary: existing.summary ?? '' };
  }
  const stored = (existing?.state as PluginState | null)?.output ?? {};
  await writeStep(runId, step, at, { status: 'running', state: { output: stored } });
  await setRunStatus(runId, 'running');
  let prepared: Awaited<ReturnType<typeof executionContext>>;
  try {
    prepared = await executionContext(sdk, runId, step, at, attempt);
  } catch (error) {
    const context = await loadRun(runId);
    return recordOutcome(runId, step, at, failure(error), context.project.id);
  }
  const { context, ctx } = prepared;
  let outcome: StepOutcome;
  try {
    outcome = sdk.resume
      ? await sdk.resume(ctx, signal)
      : { status: 'completed', output: { ...stored, ...signal.data } };
  } catch (error) {
    outcome = failure(error);
  }
  return recordOutcome(runId, step, at, outcome, context.project.id);
}

// Whether what an `approval` or `run` wait waits for has happened, for a wait that timed
// out without its signal (the process that should have sent it stopped).
async function settled(wait: PluginWait): Promise<StepSignal | null> {
  const id = Number(wait.key);
  if (!Number.isInteger(id)) return null;
  if (wait.kind === 'run') {
    const [row] = await db
      .select({ status: agentRun.status })
      .from(agentRun)
      .where(eq(agentRun.id, id));
    return row && row.status !== 'pending'
      ? { kind: 'run', key: wait.key, data: { runId: id, status: row.status } }
      : null;
  }
  if (wait.kind === 'approval') {
    const [row] = await db
      .select({ status: approvalRequest.status })
      .from(approvalRequest)
      .where(eq(approvalRequest.id, id));
    return row && row.status !== 'pending'
      ? { kind: 'approval', key: wait.key, data: { approvalId: id, status: row.status } }
      : null;
  }
  return null;
}

// Waits durably for what the step waits for.
async function waitFor(context: StepContext<PluginStep>, wait: PluginWait): Promise<StepSignal> {
  const until = wait.until ? new Date(wait.until) : null;
  if (wait.kind === 'timer') {
    await context.sleepUntil(until ?? new Date());
    return { kind: 'timer', key: wait.until ?? '' };
  }
  for (;;) {
    const left = until
      ? await context.op('left', async () => Math.ceil((until.getTime() - Date.now()) / 1000))
      : null;
    if (left !== null && left <= 0) return { kind: 'timer', key: wait.until ?? '' };
    const timeout = engineWaitSeconds(left !== null ? Math.min(left, 6 * 3600) : 6 * 3600);
    const message = await context.waitForSignal<{ data?: Record<string, unknown> }>(
      waitTopic(context.execution),
      Math.max(1, timeout),
    );
    if (message) return { kind: wait.kind, key: wait.key, data: message.data ?? {} };
    const done = await context.op('check', () => settled(wait));
    if (done) return done;
  }
}

export function adaptStepType(
  sdk: SdkStepType<unknown>,
  pluginId: string,
): WorkflowStepType<PluginStep> {
  return {
    type: sdk.id,
    ui: { builder: true, icon: sdk.icon },
    category: sdk.category,
    plugin: info(pluginId, sdk, sdk.category, sdk.outputs ?? []),
    producesResult: true,
    read(raw, reader) {
      const given = record(raw.config) ?? {};
      const config = checkConfig(sdk.configSchema, given, reader);
      try {
        const issues = sdk.validate?.(config, { project: null, previousSteps: [] });
        if (Array.isArray(issues))
          for (const issue of issues)
            reader.issue('plugin_invalid', issue.field ? `config.${issue.field}` : 'config', {
              message: clip(issue.message ?? issue.code, 200),
            });
      } catch (error) {
        reader.issue('plugin_invalid', 'config', {
          message: clip(error instanceof Error ? error.message : String(error), 200),
        });
      }
      return { config };
    },
    templateFields: (step) =>
      textLeaves(step.config).map(({ path, text }) => ({ field: `config.${path}`, text })),
    async execute(context: StepContext<PluginStep>): Promise<StepResult> {
      const { step, execution } = context;
      let answer = await context.op('start', () =>
        start(sdk, context.run.id, step, execution, context.attempt),
      );
      while (answer.status === 'waiting') {
        const signal = await waitFor(context, answer.wait);
        answer = await context.op('resume', () =>
          resume(sdk, context.run.id, step, execution, context.attempt, signal),
        );
      }
      if (answer.status === 'failed')
        return { kind: 'continue', outcome: 'failed', summary: answer.error };
      if (answer.next) return { kind: 'goto', stepId: answer.next };
      return { kind: 'continue', outcome: 'success', summary: answer.summary };
    },
  };
}

// ---- triggers -------------------------------------------------------------------------

interface PluginTrigger extends TriggerDefinition {
  config: Record<string, unknown>;
}

export function adaptTriggerType(
  sdk: SdkTriggerType<unknown>,
  pluginId: string,
): WorkflowTriggerType<PluginTrigger> {
  return {
    type: sdk.id,
    plugin: info(pluginId, sdk, null, []),
    read(raw, reader) {
      if (!sdk.events?.length) reader.issue('plugin_trigger_unsupported', 'type');
      return { config: checkConfig(sdk.configSchema, record(raw.config) ?? {}, reader) };
    },
    events: sdk.events ?? [],
    async match(trigger, event) {
      const config = await validate(sdk.configSchema, trigger.config ?? {});
      const matched = await sdk.match?.(config, event as unknown as HelenaEvent);
      if (!matched) return null;
      return {
        taskId: matched.issueId ?? null,
        input: { trigger: matched.vars ?? {} },
      };
    },
  };
}

// ---- the registries -----------------------------------------------------------------

const adaptedSteps = new WeakMap<object, WorkflowStepType>();
const adaptedTriggers = new WeakMap<object, WorkflowTriggerType>();
const refused = new Set<string>();

function refuse(kind: string, id: string): void {
  if (refused.has(`${kind}:${id}`)) return;
  refused.add(`${kind}:${id}`);
  console.warn(
    `[engine] the ${kind} type "${id}" of ${registries.stepTypes.pluginOf(id) ?? registries.triggerTypes.pluginOf(id) ?? 'a plugin'} is not namespaced (<plugin>.<name>) and is left out`,
  );
}

export function pluginStepType(name: string): WorkflowStepType | undefined {
  if (!isPluginTypeName(name)) return undefined;
  const sdk = registries.stepTypes.get(name);
  if (!sdk) return undefined;
  let adapted = adaptedSteps.get(sdk);
  if (!adapted) {
    adapted = adaptStepType(sdk, registries.stepTypes.pluginOf(name) ?? 'unknown') as never;
    adaptedSteps.set(sdk, adapted);
  }
  return adapted;
}

export function pluginTriggerType(name: string): WorkflowTriggerType | undefined {
  if (!isPluginTypeName(name)) return undefined;
  const sdk = registries.triggerTypes.get(name);
  if (!sdk) return undefined;
  let adapted = adaptedTriggers.get(sdk);
  if (!adapted) {
    adapted = adaptTriggerType(sdk, registries.triggerTypes.pluginOf(name) ?? 'unknown') as never;
    adaptedTriggers.set(sdk, adapted);
  }
  return adapted;
}

export function listPluginStepTypes(): WorkflowStepType[] {
  return registries.stepTypes.ids().flatMap((id) => {
    if (!isPluginTypeName(id)) {
      refuse('step', id);
      return [];
    }
    const type = pluginStepType(id);
    return type ? [type] : [];
  });
}

export function listPluginTriggerTypes(): WorkflowTriggerType[] {
  return registries.triggerTypes.ids().flatMap((id) => {
    if (!isPluginTypeName(id)) {
      refuse('trigger', id);
      return [];
    }
    const type = pluginTriggerType(id);
    return type ? [type] : [];
  });
}

export function eventMatches(patterns: string[] | undefined, type: string): boolean {
  return (patterns ?? []).some((pattern) => matchesEventPattern(pattern, type));
}

// ---- waking waiting steps -----------------------------------------------------------

// The engine's subscriber that wakes plugin steps waiting for what an event reports: an
// approval decided, an agent run that ended, or the event itself (`event` waits on its
// type, or on `<type>@<subject>`).
export async function wakePluginWaits(event: DomainEvent): Promise<void> {
  const keys: { kind: PluginWait['kind']; key: string }[] = [
    { kind: 'event', key: event.type },
    ...(event.subject ? [{ kind: 'event' as const, key: `${event.type}@${event.subject}` }] : []),
  ];
  if (event.type === 'helena.approval.decided' && event.data.approvalId != null)
    keys.push({ kind: 'approval', key: String(event.data.approvalId) });
  if (
    (event.type === 'helena.run.finished' || event.type === 'helena.run.failed') &&
    event.data.runId != null
  )
    keys.push({ kind: 'run', key: String(event.data.runId) });
  const rows = await db
    .select({
      runId: pipelineRunStep.runId,
      stepId: pipelineRunStep.stepId,
      iteration: pipelineRunStep.iteration,
      kind: sql<string>`${pipelineRunStep.state}->'wait'->>'kind'`,
      key: sql<string>`${pipelineRunStep.state}->'wait'->>'key'`,
    })
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.status, 'waiting'),
        sql`(${pipelineRunStep.state}->'wait') IS NOT NULL`,
        inArray(
          sql<string>`${pipelineRunStep.state}->'wait'->>'key'`,
          keys.map((item) => item.key),
        ),
      ),
    );
  for (const row of rows) {
    if (!keys.some((item) => item.kind === row.kind && item.key === row.key)) continue;
    await signalRun(row.runId, waitTopic(row), { data: event.data });
  }
}
