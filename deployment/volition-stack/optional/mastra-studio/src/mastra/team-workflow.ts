import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { HermesTeamAdapter } from './adapters/hermes-team.ts';
import { privateHermesTeamAdapter, teamIdempotencyKey } from './adapters/hermes-team.ts';
import { workEnvelopeSchema } from './contracts.ts';
import {
  agentTeamOutputSchema,
  agentTeamPayloadSchema,
  agentTeamStateSchema,
  teamHistoryEntrySchema,
  type AgentTeamPayload,
  type AgentTeamState,
  type Delegation,
  type SpecialistResult,
  type StageResult,
  type TeamPolicy,
} from './team-contracts.ts';

function history(result: StageResult) {
  return teamHistoryEntrySchema.parse(result);
}

function projectRef(state: AgentTeamState): string {
  const value = state.envelope.context?.projectRef;
  if (!value) throw new Error('Agent team execution requires a project context');
  return value;
}

// A stage waits in the runner queue before its Hermes budget starts, so the bridge
// waits five minutes longer than the budget.
function stagePolicy(policy: TeamPolicy): TeamPolicy {
  if (!policy.runBudgetSeconds) return policy;
  const timeoutSeconds = Math.min(7_200, policy.runBudgetSeconds + 300);
  return { ...policy, timeoutSeconds: Math.max(policy.timeoutSeconds, timeoutSeconds) };
}

// The specialist that gets the whole task without a coordinator stage: the only one
// of the team, or the only one whose capabilities match a label of the task. Null when
// the coordinator has to plan the work.
export function routeTask(input: AgentTeamPayload): { agentRef: string; reason: string } | null {
  if (input.specialists.length === 1) {
    return { agentRef: input.specialists[0].agentRef, reason: 'the team has one specialist' };
  }
  const labels = new Set(input.task.labels.map((label) => label.toLowerCase()));
  const matches = input.specialists.filter((specialist) =>
    specialist.capabilities.some((capability) => labels.has(capability.toLowerCase())),
  );
  if (matches.length !== 1) return null;
  return {
    agentRef: matches[0].agentRef,
    reason: 'only its capabilities match the task labels',
  };
}

// The delegations in execution order: each wave holds the assignments whose
// dependencies all belong to earlier waves. Rejects duplicate ids, unknown
// dependencies and cycles.
export function dependencyWaves(delegations: Delegation[]): Delegation[][] {
  const ids = new Set<string>();
  for (const item of delegations) {
    if (ids.has(item.assignmentId)) {
      throw new Error(`Assignment ${item.assignmentId} is delegated twice`);
    }
    ids.add(item.assignmentId);
  }
  for (const item of delegations) {
    const unknown = item.dependsOn.find((dependency) => !ids.has(dependency));
    if (unknown) {
      throw new Error(`Assignment ${item.assignmentId} depends on unknown assignment ${unknown}`);
    }
  }
  const waves: Delegation[][] = [];
  const done = new Set<string>();
  let pending = delegations;
  while (pending.length > 0) {
    const wave = pending.filter((item) => item.dependsOn.every((dependency) => done.has(dependency)));
    if (wave.length === 0) throw new Error('Assignment dependencies form a cycle');
    waves.push(wave);
    for (const item of wave) done.add(item.assignmentId);
    pending = pending.filter((item) => !done.has(item.assignmentId));
  }
  return waves;
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
      const input = agentTeamPayloadSchema.parse(inputData.payload);
      return {
        workflowId: 'agent-team' as const,
        envelope: inputData,
        input: { ...input, policy: stagePolicy(input.policy) },
        delegations: [],
        specialistResults: [],
        history: [],
        review: null,
      };
    },
  });

  const coordinate = createStep({
    id: 'coordinate',
    description:
      'Route the task to one specialist when the team or the task labels decide it, otherwise ask the coordinator for assignments.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData, abortSignal }) => {
      const { input } = inputData;
      const routed = routeTask(input);
      if (routed) {
        const now = new Date().toISOString();
        return {
          ...inputData,
          delegations: [
            {
              assignmentId: 'assignment-1',
              agentRef: routed.agentRef,
              objective: 'Complete the task: meet its objective and every acceptance criterion.',
              acceptanceCriteria: input.task.acceptanceCriteria,
              dependsOn: [],
            },
          ],
          history: [
            ...inputData.history,
            {
              executionId: 'mastra:route',
              phase: 'route' as const,
              status: 'completed' as const,
              attempt: 1,
              startedAt: now,
              completedAt: now,
              summary: `Routed to ${routed.agentRef} without a coordinator stage: ${routed.reason}.`,
            },
          ],
        };
      }
      if (inputData.envelope.dryRun) {
        return {
          ...inputData,
          delegations: input.specialists.map((specialist, index) => ({
            assignmentId: `dry-run-${index + 1}`,
            agentRef: specialist.agentRef,
            objective: input.task.objective.slice(0, 4_000),
            acceptanceCriteria: input.task.acceptanceCriteria,
            dependsOn: [],
          })),
        };
      }
      const result = await adapter.executeStage(
        {
          phase: 'coordinate',
          idempotencyKey: teamIdempotencyKey(inputData.envelope, 'coordinate', input.task.taskRef),
          projectRef: projectRef(inputData),
          task: input.task,
          agent: input.coordinator,
          allowedSpecialists: input.specialists,
          policy: input.policy,
          execution: input.execution,
        },
        abortSignal,
      );
      const allowed = new Set(input.specialists.map((item) => item.agentRef));
      if (
        result.delegations.length === 0 ||
        result.delegations.some((item) => !allowed.has(item.agentRef))
      ) {
        throw new Error('Coordinator returned an invalid specialist delegation');
      }
      dependencyWaves(result.delegations);
      return {
        ...inputData,
        delegations: result.delegations,
        history: [...inputData.history, history(result)],
      };
    },
  });

  const specialize = createStep({
    id: 'specialize',
    description:
      'Execute specialist assignments in dependency order, independent ones in parallel, with idempotent Hermes leases.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData, abortSignal }) => {
      if (inputData.envelope.dryRun) return inputData;
      const { input } = inputData;
      const members = new Map(input.specialists.map((item) => [item.agentRef, item]));
      const results: SpecialistResult[] = [];
      for (const wave of dependencyWaves(inputData.delegations)) {
        const finished = new Map(results.map((item) => [item.assignmentId, item]));
        const waveResults = await Promise.all(
          wave.map(async (assignment) => {
            const agent = members.get(assignment.agentRef);
            if (!agent) throw new Error('Specialist assignment has no project team member');
            const dependencyResults = assignment.dependsOn.map((assignmentId) => {
              const { summary, evidence } = finished.get(assignmentId)!;
              return { assignmentId, summary, evidence };
            });
            const result = await adapter.executeStage(
              {
                phase: 'specialize',
                idempotencyKey: teamIdempotencyKey(
                  inputData.envelope,
                  'specialize',
                  assignment.assignmentId,
                ),
                projectRef: projectRef(inputData),
                task: input.task,
                agent,
                assignment,
                ...(dependencyResults.length > 0 ? { dependencyResults } : {}),
                policy: input.policy,
                execution: input.execution,
              },
              abortSignal,
            );
            return { ...result, assignmentId: assignment.assignmentId };
          }),
        );
        results.push(...waveResults);
      }
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
      'Have the coordinator review specialist evidence against the acceptance criteria when the policy requires a review.',
    inputSchema: agentTeamStateSchema,
    outputSchema: agentTeamStateSchema,
    retries: 2,
    execute: async ({ inputData, abortSignal }) => {
      if (inputData.envelope.dryRun || !inputData.input.policy.reviewRequired) return inputData;
      const result = await adapter.executeStage(
        {
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
        },
        abortSignal,
      );
      if (!result.review) throw new Error('Coordinator review result is missing');
      return { ...inputData, review: result, history: [...inputData.history, history(result)] };
    },
  });

  const synchronize = createStep({
    id: 'synchronize-plan',
    description:
      'Write the result to the matching Plan task exactly once and move it to Review, or to Done when the policy allows it and the review accepted the work.',
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
      const { policy } = inputData.input;
      const reviewStage = inputData.review;
      if (policy.reviewRequired && !reviewStage?.review)
        throw new Error('Coordinator review is required before Plan synchronization');
      const state =
        policy.autonomy === 'done' && reviewStage?.review?.accepted
          ? ('done' as const)
          : ('review' as const);
      const summary = reviewStage?.review
        ? reviewStage.review.notes || reviewStage.summary
        : inputData.specialistResults
            .map((item) => item.summary)
            .join('\n\n')
            .slice(0, 4_000);
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
