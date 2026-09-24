import { bumpControlPlaneRevision } from '#modules/sync/service';
import {
  DATE_FIELDS,
  LIMITS,
  TIME,
  type WaitSpec,
  type WaitStep,
} from '#modules/pipelines/definition';
import { wakeTime } from '#modules/pipelines/wait';
import { defaultTimezone } from '../../settings';
import { loadRun, setRunStatus, stepRow, writeStep } from '../../run-context';
import type { FieldReader, StepContext, StepExecution, WorkflowStepType } from '../../sdk';

// A wait: the run sleeps for a delay, or until a time of day (in the instance's time
// zone) on the task's due or start date. The wake time is fixed when the step starts, so a run continued after
// a restart wakes when it would have. A test run does not wait.

type Step = WaitStep & { [field: string]: unknown };

function readWait(raw: unknown, reader: FieldReader): WaitSpec {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const kind = reader.choice(value?.kind, 'wait.kind', ['delay', 'until'] as const);
  if (kind === 'delay')
    return { kind, minutes: reader.integer(value?.minutes, 'wait.minutes', LIMITS.delayMinutes) };
  const time = typeof value?.time === 'string' ? value.time : '';
  if (!TIME.test(time)) reader.issue('invalid', 'wait.time');
  return { kind, field: reader.choice(value?.field, 'wait.field', DATE_FIELDS), time };
}

async function plan(runId: string, step: WaitStep, at: StepExecution): Promise<string | null> {
  const existing = await stepRow(runId, at);
  if (existing?.status === 'succeeded' || existing?.status === 'simulated') return null;
  const context = await loadRun(runId);
  const wakeAt =
    existing?.wakeAt ?? wakeTime(step.wait, context.task, Date.now(), await defaultTimezone());
  if (context.run.dryRun || !wakeAt || wakeAt.getTime() <= Date.now()) {
    await writeStep(runId, step, at, {
      status: context.run.dryRun ? 'simulated' : 'succeeded',
      outcome: 'success',
      wakeAt,
      finishedAt: new Date(),
    });
    await bumpControlPlaneRevision(context.project.id);
    return null;
  }
  await writeStep(runId, step, at, { status: 'waiting', wakeAt });
  await setRunStatus(runId, 'waiting');
  await bumpControlPlaneRevision(context.project.id);
  return wakeAt.toISOString();
}

async function woke(runId: string, step: WaitStep, at: StepExecution): Promise<void> {
  await writeStep(runId, step, at, {
    status: 'succeeded',
    outcome: 'success',
    finishedAt: new Date(),
  });
  await setRunStatus(runId, 'running');
}

export const waitStep: WorkflowStepType<Step> = {
  type: 'wait',
  ui: { builder: true, icon: 'hourglass' },
  read(value, reader) {
    return { wait: readWait(value.wait, reader) };
  },
  async execute(context: StepContext<Step>) {
    const { step, execution } = context;
    const wakeAt = await context.op('plan', () => plan(context.run.id, step, execution));
    if (wakeAt) {
      await context.sleepUntil(new Date(wakeAt));
      await context.op('woke', () => woke(context.run.id, step, execution));
    }
    return { kind: 'continue', outcome: 'success' };
  },
};
