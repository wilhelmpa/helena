import { agentResultSchema, type AgentResult } from '../pipeline-contracts.ts';
import { bridgeRequest, withBackoff } from './hermes-team.ts';

export type PipelineOperation =
  | 'begin'
  | 'agent'
  | 'condition'
  | 'action'
  | 'approval'
  | 'wait'
  | 'record'
  | 'finish';

export interface AgentRequest {
  idempotencyKey: string;
  projectRef: string;
  taskRef: string;
  agentRef: string;
  prompt: string;
  timeoutSeconds: number;
  policy: { maxTurns?: number; runBudgetSeconds?: number; model?: string };
}

export interface PlanPipelineAdapter {
  // One operation of Plan's pipeline control API. Plan answers a repeated request for
  // the same step execution with what the first one did.
  control(operation: PipelineOperation, body: Record<string, unknown>): Promise<unknown>;
  // Queues the agent run of an agent step in Plan and waits until it finished. `signal`
  // is the abort signal of the workflow step; aborting it cancels the Plan run.
  runAgent(request: AgentRequest, signal?: AbortSignal): Promise<AgentResult>;
}

// Every control operation is idempotent, so a Plan restart or a dropped connection is
// retried. An agent step is not: a failed one is retried by a person, as a new attempt.
const RETRIES = { maxAttempts: 3, initialBackoffMs: 1_000, maxBackoffMs: 5_000, backoffMultiplier: 2 };

export const privatePlanPipelineAdapter: PlanPipelineAdapter = {
  control(operation, body) {
    return withBackoff(RETRIES, () =>
      bridgeRequest(
        '/internal/hermes/team/pipeline',
        { schemaVersion: 1, operation, ...body },
        60_000,
      ),
    );
  },
  async runAgent(request, signal) {
    const raw = await bridgeRequest(
      '/internal/hermes/team/pipeline-agent',
      { schemaVersion: 1, ...request },
      (request.timeoutSeconds + 60) * 1_000,
      signal,
    );
    return agentResultSchema.parse(raw);
  },
};
