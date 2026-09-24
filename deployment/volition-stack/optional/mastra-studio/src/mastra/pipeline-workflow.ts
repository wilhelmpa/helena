import { setTimeout as sleep } from 'node:timers/promises';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import {
  privatePlanPipelineAdapter,
  type PlanPipelineAdapter,
} from './adapters/plan-pipeline.ts';
import { workEnvelopeSchema } from './contracts.ts';
import {
  agentPreparationSchema,
  approvalDecisionSchema,
  beginAnswerSchema,
  pipelineOutputSchema,
  pipelinePayloadSchema,
  pipelineStateSchema,
  type PipelineState,
  type PipelineStep,
} from './pipeline-contracts.ts';
import { MISSED_FIRE_MS } from './routine-workflow.ts';
import { fireEnvelope, scheduleFire, scopeRunToProject } from './scheduled-runs.ts';

// Runs a workflow of Plan's workflow builder: a loop that executes one step per
// iteration, so every step execution is a checkpoint Mastra continues from after a
// restart, and a retry starts again at the step that failed. Plan evaluates and applies
// each step and records its result; Mastra decides which step follows.

// A bound on step executions per run, above the rework loops a definition allows.
export const MAX_EXECUTIONS = 200;

interface Located {
  step: PipelineStep;
  lane: PipelineStep[];
  index: number;
  parent: Located | null;
  branch: 'then' | 'else' | null;
}

export function locate(steps: PipelineStep[], id: string): Located | null {
  const walk = (
    lane: PipelineStep[],
    parent: Located | null,
    branch: Located['branch'],
  ): Located | null => {
    for (const [index, step] of lane.entries()) {
      const here: Located = { step, lane, index, parent, branch };
      if (step.id === id) return here;
      if (step.type === 'condition') {
        const found =
          walk(step.then ?? [], here, 'then') ?? walk(step.else ?? [], here, 'else');
        if (found) return found;
      }
    }
    return null;
  };
  return walk(steps, null, null);
}

// The step that follows `id` when the step went its usual way: the next one of its
// lane, or once the lane is over the step after the condition that holds it. Null
// ends the run, as does a lane that ends it.
export function stepAfter(steps: PipelineStep[], id: string): string | null {
  const here = locate(steps, id);
  if (!here) throw new Error(`The workflow has no step ${id}`);
  const next = here.lane[here.index + 1];
  if (next) return next.id;
  if (!here.parent) return null;
  const ends = here.branch === 'then' ? here.parent.step.thenEnd : here.parent.step.elseEnd;
  return ends ? null : stepAfter(steps, here.parent.step.id);
}

// Where a condition sends the run: the first step of the lane of its answer.
export function branchStart(steps: PipelineStep[], id: string, matched: boolean): string | null {
  const condition = locate(steps, id)?.step;
  if (!condition) throw new Error(`The workflow has no step ${id}`);
  const lane = (matched ? condition.then : condition.else) ?? [];
  if (lane.length > 0) return lane[0].id;
  return (matched ? condition.thenEnd : condition.elseEnd) ? null : stepAfter(steps, id);
}

// An agent step that failed or was blocked ends the run, unless the step after it
// branches on that outcome.
export function handlesOutcome(steps: PipelineStep[], next: string | null): boolean {
  if (!next) return false;
  const step = locate(steps, next)?.step;
  return step?.type === 'condition' && step.condition?.kind === 'outcome';
}

class StepFailed extends Error {}

async function sleepUntil(wakeAt: string, signal: AbortSignal): Promise<void> {
  // setTimeout takes at most 2^31 - 1 ms; a wait of weeks sleeps a day at a time.
  for (;;) {
    const left = Date.parse(wakeAt) - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(left, 86_400_000), undefined, { signal });
  }
}

export function buildPipelineWorkflow(
  adapter: PlanPipelineAdapter = privatePlanPipelineAdapter,
  now: () => number = Date.now,
) {
  const prepare = createStep({
    id: 'prepare-pipeline',
    description:
      'Take the run from Helena: its task and the pinned version of the workflow. A schedule fire gets a task and a run of its own.',
    inputSchema: workEnvelopeSchema,
    outputSchema: pipelineStateSchema,
    retries: 2,
    execute: async ({ inputData, runId, workflowId, mastra }) => {
      const envelope = fireEnvelope(inputData, runId);
      const projectRef = envelope.context?.projectRef;
      if (!projectRef) throw new Error('A workflow run requires a project context');
      const payload = pipelinePayloadSchema.parse(envelope.payload);
      await scopeRunToProject(mastra, workflowId, runId, projectRef);
      const fire = scheduleFire(runId);
      const base = { envelope, seq: 0, visits: {}, reworks: {} };
      if (fire && now() - fire.firedAt > MISSED_FIRE_MS) {
        return {
          ...base,
          run: { id: runId, projectRef, taskRef: null, dryRun: envelope.dryRun },
          definition: { schemaVersion: 1 as const, steps: [] },
          cursor: null,
          status: 'skipped' as const,
        };
      }
      const begun = beginAnswerSchema.parse(
        await adapter.control('begin', {
          runId,
          projectRef,
          pipelineId: payload.pipelineId,
          dryRun: envelope.dryRun,
        }),
      );
      return {
        ...base,
        run: {
          id: begun.run.id,
          projectRef,
          taskRef: begun.run.taskRef,
          dryRun: begun.run.dryRun,
        },
        definition: begun.definition,
        cursor: begun.definition.steps[0]?.id ?? null,
        status: 'running' as const,
      };
    },
  });

  const runStep = createStep({
    id: 'run-pipeline-step',
    description:
      'Execute one step: an agent step through the Helena run queue, an approval that waits for a person, a condition, a task action or a wait.',
    inputSchema: pipelineStateSchema,
    outputSchema: pipelineStateSchema,
    resumeSchema: approvalDecisionSchema,
    // A failed step ends the run; a person retries it.
    retries: 0,
    execute: async ({ inputData: state, resumeData, suspend, abortSignal }) => {
      if (state.cursor === null) return state;
      if (state.seq >= MAX_EXECUTIONS)
        throw new StepFailed(`The run executed ${MAX_EXECUTIONS} steps and was stopped`);
      const steps = state.definition.steps;
      const step = locate(steps, state.cursor)?.step;
      if (!step) throw new StepFailed(`The workflow has no step ${state.cursor}`);
      const iteration = (state.visits[step.id] ?? 0) + 1;
      const at = { runId: state.run.id, projectRef: state.run.projectRef, stepId: step.id, iteration, seq: state.seq + 1 };
      const next: PipelineState = {
        ...state,
        seq: at.seq,
        visits: { ...state.visits, [step.id]: iteration },
      };
      const plan = (operation: Parameters<PlanPipelineAdapter['control']>[0], body = {}) =>
        adapter.control(operation, { ...at, ...body });
      try {
        switch (step.type) {
          case 'agent': {
            const prepared = agentPreparationSchema.parse(await plan('agent'));
            const following = stepAfter(steps, step.id);
            if (prepared.dryRun) return { ...next, cursor: following };
            const result = await adapter.runAgent(
              {
                idempotencyKey: prepared.idempotencyKey,
                projectRef: state.run.projectRef,
                taskRef: prepared.taskRef,
                agentRef: prepared.agentRef,
                prompt: prepared.prompt,
                timeoutSeconds: prepared.timeoutSeconds,
                policy: prepared.policy,
              },
              abortSignal,
            );
            await plan('record', {
              status: result.outcome === 'success' ? 'succeeded' : 'failed',
              outcome: result.outcome,
              summary: result.summary,
            });
            if (result.outcome !== 'success' && !handlesOutcome(steps, following))
              throw new StepFailed(
                result.outcome === 'blocked'
                  ? `Step "${step.name}" is blocked: ${result.summary}`
                  : `Step "${step.name}" failed: ${result.summary}`,
              );
            return { ...next, cursor: following };
          }
          case 'condition': {
            const { matched } = (await plan('condition')) as { matched: boolean };
            return { ...next, cursor: branchStart(steps, step.id, matched === true) };
          }
          case 'action':
            await plan('action');
            return { ...next, cursor: stepAfter(steps, step.id) };
          case 'wait': {
            const { wakeAt } = (await plan('wait')) as { wakeAt: string | null };
            if (wakeAt) {
              await sleepUntil(wakeAt, abortSignal);
              await plan('record', { status: 'succeeded', outcome: 'success' });
            }
            return { ...next, cursor: stepAfter(steps, step.id) };
          }
          case 'approval': {
            if (!resumeData) {
              const { message } = (await plan('approval', { phase: 'wait' })) as {
                message: string;
              };
              if (state.run.dryRun) return { ...next, cursor: stepAfter(steps, step.id) };
              return await suspend({ stepId: step.id, message });
            }
            await plan('approval', { phase: 'decided', ...resumeData });
            if (resumeData.approved) return { ...next, cursor: stepAfter(steps, step.id) };
            const rework = step.onReject;
            const loops = state.reworks[step.id] ?? 0;
            if (rework?.action === 'goto' && loops < rework.maxLoops)
              return {
                ...next,
                reworks: { ...state.reworks, [step.id]: loops + 1 },
                cursor: rework.stepId,
              };
            return { ...next, cursor: null, status: 'rejected' as const };
          }
        }
      } catch (error) {
        // A canceled run is already marked in Plan by the person who canceled it.
        if (!abortSignal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          await plan('record', { status: 'failed', error: message }).catch(() => {});
          await adapter
            .control('finish', {
              runId: state.run.id,
              projectRef: state.run.projectRef,
              status: 'failed',
              error: message,
            })
            .catch(() => {});
        }
        throw error;
      }
    },
  });

  const finish = createStep({
    id: 'finish-pipeline',
    description: 'Record in Helena that the run succeeded, or ended at a rejected approval.',
    inputSchema: pipelineStateSchema,
    outputSchema: pipelineOutputSchema,
    retries: 2,
    execute: async ({ inputData: state }) => {
      const status = state.status === 'running' ? 'succeeded' : state.status;
      if (status !== 'skipped')
        await adapter.control('finish', {
          runId: state.run.id,
          projectRef: state.run.projectRef,
          status,
        });
      return {
        workflowId: 'plan-pipeline' as const,
        runId: state.run.id,
        projectRef: state.run.projectRef,
        taskRef: state.run.taskRef,
        status: state.run.dryRun && status === 'succeeded' ? ('dry-run-complete' as const) : status,
        executedSteps: state.seq,
      };
    },
  });

  return createWorkflow({
    id: 'plan-pipeline',
    description:
      "Run a workflow of Helena's workflow builder: agent steps through the Helena run queue, approvals in Helena's approvals inbox, conditions, task actions and waits.",
    inputSchema: workEnvelopeSchema,
    outputSchema: pipelineOutputSchema,
  })
    .then(prepare)
    .dountil(runStep, async ({ inputData }) => inputData.cursor === null)
    .then(finish)
    .commit();
}

export const planPipelineWorkflow = buildPipelineWorkflow();
