import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { HermesTeamAdapter } from './adapters/hermes-team.ts';
import { privateHermesTeamAdapter, teamIdempotencyKey } from './adapters/hermes-team.ts';
import { workEnvelopeSchema } from './contracts.ts';
import {
  agentTeamOutputSchema,
  agentTeamPayloadSchema,
  agentTeamStateSchema,
  teamHistoryEntrySchema,
  type AgentTeamState,
  type StageResult,
} from './team-contracts.ts';

function history(result: StageResult) {
  return teamHistoryEntrySchema.parse(result);
}

function projectRef(state: AgentTeamState): string {
  const value = state.envelope.context?.projectRef;
  if (!value) throw new Error('Agent team execution requires a project context');
  return value;
}

export function buildAgentTeamWorkflow(adapter: HermesTeamAdapter = privateHermesTeamAdapter) {
  const prepare = createStep({
    id: 'prepare-team',
    description: 'Validate the project team, execution policy and stable task identity.',
    inputSchema: workEnvelopeSchema,
    outputSchema: agentTeamStateSchema,
    execute: async ({ inputData }) => {
      if (!inputData.context?.projectRef)
        throw new Error('Agent team execution requires a project context');
      return {
        workflowId: 'agent-team' as const,
        envelope: inputData,
        input: agentTeamPayloadSchema.parse(inputData.payload),
        delegations: [],
        specialistResults: [],
        history: [],
        review: null,
      };
    },
  });

  const coordinate = createStep({
    id: 'coordinate',
    description: 'Ask the project coordinator to create bounded specialist assignments.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      if (inputData.envelope.dryRun) {
        return {
          ...inputData,
          delegations: inputData.input.specialists.map((specialist, index) => ({
            assignmentId: `dry-run-${index + 1}`,
            agentRef: specialist.agentRef,
            objective: inputData.input.task.objective,
            acceptanceCriteria: inputData.input.task.acceptanceCriteria,
            dependsOn: [],
          })),
        };
      }
      const result = await adapter.executeStage({
        phase: 'coordinate',
        idempotencyKey: teamIdempotencyKey(
          inputData.envelope,
          'coordinate',
          inputData.input.task.taskRef,
        ),
        projectRef: projectRef(inputData),
        task: inputData.input.task,
        agent: inputData.input.coordinator,
        allowedSpecialists: inputData.input.specialists,
        policy: inputData.input.policy,
        execution: inputData.input.execution,
      });
      const allowed = new Set(inputData.input.specialists.map((item) => item.agentRef));
      if (
        result.delegations.length === 0 ||
        result.delegations.some((item) => !allowed.has(item.agentRef))
      ) {
        throw new Error('Coordinator returned an invalid specialist delegation');
      }
      if (result.delegations.some((item) => item.dependsOn.length > 0)) {
        throw new Error('Agent team execution accepts only independent specialist assignments');
      }
      return {
        ...inputData,
        delegations: result.delegations,
        history: [...inputData.history, history(result)],
      };
    },
  });

  const specialize = createStep({
    id: 'specialize',
    description: 'Execute independent specialist assignments with idempotent Hermes leases.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      if (inputData.envelope.dryRun) return inputData;
      const members = new Map(inputData.input.specialists.map((item) => [item.agentRef, item]));
      const results = await Promise.all(
        inputData.delegations.map(async (assignment) => {
          const agent = members.get(assignment.agentRef);
          if (!agent) throw new Error('Specialist assignment has no project team member');
          return adapter.executeStage({
            phase: 'specialize',
            idempotencyKey: teamIdempotencyKey(
              inputData.envelope,
              'specialize',
              assignment.assignmentId,
            ),
            projectRef: projectRef(inputData),
            task: inputData.input.task,
            agent,
            assignment,
            policy: inputData.input.policy,
            execution: inputData.input.execution,
          });
        }),
      );
      return {
        ...inputData,
        specialistResults: results,
        history: [...inputData.history, ...results.map(history)],
      };
    },
  });

  const review = createStep({
    id: 'review',
    description:
      'Require the coordinator to review specialist evidence against acceptance criteria.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      if (inputData.envelope.dryRun) return inputData;
      const result = await adapter.executeStage({
        phase: 'review',
        idempotencyKey: teamIdempotencyKey(
          inputData.envelope,
          'review',
          inputData.input.task.taskRef,
        ),
        projectRef: projectRef(inputData),
        task: inputData.input.task,
        agent: inputData.input.coordinator,
        specialistResults: inputData.specialistResults,
        policy: inputData.input.policy,
        execution: inputData.input.execution,
      });
      if (!result.review) throw new Error('Coordinator review result is missing');
      return { ...inputData, review: result, history: [...inputData.history, history(result)] };
    },
  });

  const synchronize = createStep({
    id: 'synchronize-plan',
    description: 'Synchronize the reviewed result to the matching Plan task exactly once.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamOutputSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      const evidence = inputData.specialistResults.flatMap((item) => item.evidence);
      if (inputData.envelope.dryRun) {
        return {
          workflowId: 'agent-team' as const,
          correlationId: inputData.envelope.correlationId,
          projectRef: projectRef(inputData),
          taskRef: inputData.input.task.taskRef,
          status: 'dry-run-complete' as const,
          summary: `Validated ${inputData.delegations.length} specialist assignments; no Hermes or Plan call was made.`,
          evidence: [],
          history: inputData.history,
          planSync: { state: 'simulated' as const, synchronizedAt: null },
        };
      }
      if (!inputData.review?.review)
        throw new Error('Coordinator review is required before Plan synchronization');
      const state = inputData.review.review.accepted ? ('done' as const) : ('review' as const);
      const summary = inputData.review.review.notes || inputData.review.summary;
      const synced = await adapter.synchronizePlan({
        idempotencyKey: teamIdempotencyKey(
          inputData.envelope,
          'synchronize',
          inputData.input.task.taskRef,
        ),
        projectRef: projectRef(inputData),
        taskRef: inputData.input.task.taskRef,
        state,
        summary,
        evidence,
      });
      return {
        workflowId: 'agent-team' as const,
        correlationId: inputData.envelope.correlationId,
        projectRef: projectRef(inputData),
        taskRef: inputData.input.task.taskRef,
        status: state,
        summary,
        evidence,
        history: inputData.history,
        planSync: { state, synchronizedAt: synced.synchronizedAt },
      };
    },
  });

  return createWorkflow({
    id: 'agent-team',
    description:
      'Coordinate a project agent team through Hermes and synchronize reviewed evidence to Plan.',
    inputSchema: workEnvelopeSchema,
    outputSchema: agentTeamOutputSchema,
    retryConfig: { attempts: 3, delay: 1_000 },
  })
    .then(prepare)
    .then(coordinate)
    .then(specialize)
    .then(review)
    .then(synchronize)
    .commit();
}

export const agentTeamWorkflow = buildAgentTeamWorkflow();
