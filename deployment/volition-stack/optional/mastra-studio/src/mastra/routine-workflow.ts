import type { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import {
  privatePlanRoutineAdapter,
  routineIdempotencyKey,
  type PlanRoutineAdapter,
} from './adapters/plan-routine.ts';
import { workEnvelopeSchema } from './contracts.ts';
import {
  agentRoutineOutputSchema,
  agentRoutinePayloadSchema,
  agentRoutineStateSchema,
} from './routine-contracts.ts';
import { fireEnvelope, runOutput, scheduleFire, scopeRunToProject } from './scheduled-runs.ts';

// A fire that starts this much later than its time is skipped. Mastra fires a schedule
// that came due while it was stopped once when it starts again; the work of a routine
// belongs to the time it was scheduled for.
export const MISSED_FIRE_MS = 10 * 60_000;

// How many fires of the schedule are searched for the task the routine created last.
const HISTORY_FIRES = 50;

// The task recorded by the newest earlier fire of the same schedule. Every finished
// fire records the routine's task, a skipped one included, so a routine keeps
// coalescing onto its open task however many fires it skipped.
export async function previousTask(
  mastra: Mastra | undefined,
  workflowName: string,
  runId: string,
): Promise<string | undefined> {
  const fire = scheduleFire(runId);
  const storage = mastra?.getStorage();
  if (!fire || !storage) return undefined;
  const schedules = await storage.getStore('schedules');
  const workflows = await storage.getStore('workflows');
  if (!schedules || !workflows) return undefined;
  for (const trigger of await schedules.listTriggers(fire.scheduleId, { limit: HISTORY_FIRES })) {
    if (!trigger.runId || trigger.runId === runId) continue;
    const run = await workflows.getWorkflowRunById({ runId: trigger.runId, workflowName });
    const snapshot = typeof run?.snapshot === 'string' ? JSON.parse(run.snapshot) : run?.snapshot;
    if (snapshot?.status !== 'success') continue;
    const taskRef = agentRoutineOutputSchema.safeParse(runOutput(snapshot.result)).data?.taskRef;
    if (taskRef) return taskRef;
  }
  return undefined;
}

export function buildAgentRoutineWorkflow(
  adapter: PlanRoutineAdapter = privatePlanRoutineAdapter,
  now: () => number = Date.now,
) {
  const prepare = createStep({
    id: 'prepare-routine',
    description:
      'Take the event id of this fire from its run id, list the run in its project and mark a fire that started too late.',
    inputSchema: workEnvelopeSchema,
    outputSchema: agentRoutineStateSchema,
    execute: async ({ inputData, runId, workflowId, mastra }) => {
      const envelope = fireEnvelope(inputData, runId);
      const input = agentRoutinePayloadSchema.parse(envelope.payload);
      if (envelope.context?.projectRef !== input.projectRef) {
        throw new Error('The routine names another project than its schedule');
      }
      await scopeRunToProject(mastra, workflowId, runId, input.projectRef);
      const fire = scheduleFire(runId);
      return { envelope, input, missed: fire !== null && now() - fire.firedAt > MISSED_FIRE_MS };
    },
  });

  const dispatch = createStep({
    id: 'dispatch-routine',
    description:
      'Ask Plan to create or reopen the task and delegate it to the agent, unless the task of the routine is still open.',
    inputSchema: agentRoutineStateSchema,
    outputSchema: agentRoutineOutputSchema,
    retries: 2,
    execute: async ({ inputData, runId, workflowId, mastra }) => {
      const { envelope, input } = inputData;
      const taskRef =
        input.mode === 'reopen' ? input.taskRef : await previousTask(mastra, workflowId, runId);
      const output = {
        workflowId: 'agent-routine' as const,
        correlationId: envelope.correlationId,
        projectRef: input.projectRef,
      };
      if (inputData.missed) {
        return { ...output, status: 'skipped' as const, taskRef: taskRef ?? null, skipReason: 'missed' as const };
      }
      if (envelope.dryRun) {
        return { ...output, status: 'dry-run-complete' as const, taskRef: taskRef ?? null, skipReason: null };
      }
      const answer = await adapter.dispatch({
        idempotencyKey: routineIdempotencyKey(envelope),
        projectRef: input.projectRef,
        agentRef: input.agentRef,
        title: input.title,
        instructions: input.instructions,
        mode: input.mode,
        ...(taskRef ? { taskRef } : {}),
        ...(envelope.actor.type === 'human' ? { actorId: envelope.actor.id } : {}),
      });
      return {
        ...output,
        status: answer.outcome,
        taskRef: answer.taskRef,
        skipReason: answer.outcome === 'skipped' ? ('task-open' as const) : null,
      };
    },
  });

  return createWorkflow({
    id: 'agent-routine',
    description:
      'Create or reopen a Plan task on a schedule and delegate it to a project agent, one open task at a time.',
    inputSchema: workEnvelopeSchema,
    outputSchema: agentRoutineOutputSchema,
  })
    .then(prepare)
    .then(dispatch)
    .commit();
}

export const agentRoutineWorkflow = buildAgentRoutineWorkflow();
