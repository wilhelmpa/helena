import { DBOS, Error as DBOSErrors } from '@dbos-inc/dbos-sdk';
import { registerBuiltins } from './builtin/index';
import { approvalStep } from './builtin/steps/approval';
import { askStepPolicy } from './policy';
import { RUNS_QUEUE } from './dbos';
import { beginRun, enterStep, failRun, finishRun, leaveStep, runCanceled } from './lifecycle';
import { branchStart, handlesOutcome, locate, stepAfter } from './navigation';
import { domainEventSubscribers, stepType } from './registry';
import { subscribeEngineTriggers } from './events';
import { writeStep } from './run-context';
import { planFire } from './schedules';
import {
  actionRank,
  StepFailure,
  type DomainEvent,
  type RunInfo,
  type StepContext,
  type StepDefinition,
  type StepExecution,
  type StepResult,
  type WorkflowDefinition,
  type WorkflowStepType,
} from './sdk';

// The two DBOS workflows of the engine. `helena.run` interprets one run: it walks the
// run's pinned definition and executes each step through its registered type; every
// step execution is a sequence of recorded operations named `helena:<step>#<iteration>:
// <operation>`, so a restart continues inside the step and a retry forks the workflow at
// the first operation of the failed step. `helena.fire` is what a schedule starts at each
// scheduled time: it applies the catch-up policy, records the run and starts it.

// A bound on step executions per run, above the rework loops a definition allows.
export const MAX_EXECUTIONS = 200;

// The operations of one step execution, as the step type sees them.
class EngineStepContext<S extends StepDefinition> implements StepContext<S> {
  private readonly prefix: string;

  constructor(
    readonly run: RunInfo,
    readonly step: S,
    readonly execution: StepExecution,
    readonly attempt: number,
    readonly definition: WorkflowDefinition,
  ) {
    this.prefix = `helena:${step.id}#${execution.iteration}:`;
  }

  op<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return DBOS.runStep(fn, { name: this.prefix + name });
  }

  async sleepUntil(at: Date): Promise<void> {
    const ms = await this.op('sleep', async () => Math.max(0, at.getTime() - Date.now()));
    if (ms > 0) await DBOS.sleep(ms);
  }

  waitForSignal<T>(topic: string, timeoutSeconds: number): Promise<T | null> {
    return DBOS.recv<T>(topic, timeoutSeconds);
  }
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof DBOSErrors.DBOSWorkflowCancelledError ||
    error instanceof DBOSErrors.DBOSAwaitedWorkflowCancelledError
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Asks the policy host whether the step may do what its type does (policy.ts). A refusal
// fails the step; "ask a person first" opens an approval of its own, `<step>.approval`,
// which the Approvals page lists like an approval step: approved, the step executes;
// rejected, the run ends as rejected. Answers the result that ends the step instead of
// executing it, or null to execute it.
async function passPolicy(
  run: RunInfo,
  step: StepDefinition,
  type: WorkflowStepType,
  execution: StepExecution,
  definition: WorkflowDefinition,
): Promise<StepResult | null> {
  if (!type.category || actionRank(type.category) <= actionRank('report')) return null;
  const verdict = await DBOS.runStep(() => askStepPolicy(run.id, step, type), {
    name: `helena:${step.id}#${execution.iteration}:policy`,
  });
  if (verdict.effect === 'allow') return null;
  if (verdict.effect === 'deny') throw new StepFailure(`Not allowed: ${verdict.reason}`, 'blocked');
  const gate = {
    id: `${step.id}.approval`,
    name: step.name,
    type: 'approval',
    message: verdict.reason,
    onReject: { action: 'end' as const },
  };
  const decided = await approvalStep.execute(
    new EngineStepContext(
      run,
      gate as never,
      { stepId: gate.id, iteration: execution.iteration, seq: execution.seq },
      1,
      definition,
    ),
  );
  if (decided.kind !== 'end') return null;
  await DBOS.runStep(
    () =>
      writeStep(run.id, step, execution, {
        status: 'skipped',
        outcome: 'rejected',
        summary: verdict.reason,
        finishedAt: new Date(),
      }),
    { name: `helena:${step.id}#${execution.iteration}:rejected` },
  );
  return decided;
}

async function interpret(runId: string): Promise<string> {
  registerBuiltins();
  const begun = await DBOS.runStep(() => beginRun(runId, DBOS.workflowID ?? runId), {
    name: 'helena:begin',
  });
  if (begun.status !== 'running') return begun.status;
  const { run } = begun;
  const definition = begun.definition as unknown as WorkflowDefinition;
  const steps = definition.steps;
  const fail = async (message: string, at: StepExecution | null, step: StepDefinition | null) => {
    await DBOS.runStep(() => failRun(runId, at, step, message), { name: 'helena:fail' });
    throw new Error(message);
  };

  let cursor: string | null = steps[0]?.id ?? null;
  let seq = 0;
  const visits: Record<string, number> = {};
  let end: { status: 'succeeded' | 'rejected' | 'skipped'; result?: unknown } = {
    status: 'succeeded',
  };
  while (cursor !== null) {
    if (seq >= MAX_EXECUTIONS)
      await fail(`The run executed ${MAX_EXECUTIONS} steps and was stopped`, null, null);
    const step: StepDefinition | undefined = locate(steps, cursor)?.step;
    if (!step) return fail(`The workflow has no step ${cursor}`, null, null);
    const type = stepType(step.type);
    const iteration = (visits[step.id] ?? 0) + 1;
    visits[step.id] = iteration;
    seq += 1;
    const execution: StepExecution = { stepId: step.id, iteration, seq };
    if (!type) return fail(`The step type ${step.type} is not installed`, execution, step);
    let result: StepResult;
    try {
      const attempt = await DBOS.runStep(() => enterStep(runId, step, execution), {
        name: `helena:${step.id}#${iteration}:enter`,
      });
      const gate = await passPolicy(run, step, type, execution, definition);
      result =
        gate ??
        (await type.execute(new EngineStepContext(run, step, execution, attempt, definition)));
    } catch (error) {
      if (isCancellation(error)) throw error;
      // A person who canceled the run already ended it; nothing more is recorded.
      if (await DBOS.runStep(() => runCanceled(runId), { name: 'helena:canceled' })) throw error;
      return fail(messageOf(error), execution, step);
    }
    switch (result.kind) {
      case 'branch':
        cursor = branchStart(steps, step.id, result.matched);
        break;
      case 'goto':
        cursor = result.stepId;
        break;
      case 'end':
        cursor = null;
        end = { status: result.status, result: result.result };
        break;
      case 'continue': {
        const following = stepAfter(steps, step.id);
        if (
          (result.outcome === 'failed' || result.outcome === 'blocked') &&
          !handlesOutcome(steps, following)
        )
          return fail(
            result.outcome === 'blocked'
              ? `Step "${step.name}" is blocked: ${result.summary ?? ''}`.trim()
              : `Step "${step.name}" failed${result.summary ? `: ${result.summary}` : ''}`,
            execution,
            step,
          );
        cursor = following;
        break;
      }
    }
    await DBOS.runStep(
      () => leaveStep(runId, execution, result.kind === 'continue' ? result.outcome : undefined),
      { name: `helena:${step.id}#${iteration}:leave` },
    );
  }
  await DBOS.runStep(() => finishRun(runId, end.status, end.result), { name: 'helena:finish' });
  return end.status;
}

export const runWorkflow = DBOS.registerWorkflow(interpret, { name: 'helena.run' });

// One fire of a schedule (schedules.ts): the run it plans, started once.
async function fire(scheduleId: string, scheduledAtIso: string): Promise<void> {
  const planned = await DBOS.runStep(() => planFire(scheduleId, scheduledAtIso), {
    name: 'helena:fire',
  });
  if (planned)
    await DBOS.startWorkflow(runWorkflow, { workflowID: planned, queueName: RUNS_QUEUE })(planned);
}

export const fireWorkflow = DBOS.registerWorkflow(fire, { name: 'helena.fire' });

// The outbox's workflow: hands one domain event to every subscriber, each once.
async function deliver(event: DomainEvent): Promise<void> {
  registerBuiltins();
  subscribeEngineTriggers();
  for (const [name, handler] of domainEventSubscribers())
    await DBOS.runStep(() => handler(event), { name: `helena:event:${name}` });
}

export const eventWorkflow = DBOS.registerWorkflow(deliver, { name: 'helena.event' });
