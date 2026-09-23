import { createHash } from 'node:crypto';
import type { WorkEnvelope } from '../contracts.ts';
import {
  routineAnswerSchema,
  type AgentRoutinePayload,
  type RoutineAnswer,
} from '../routine-contracts.ts';
import { BRIDGE_OUTAGE_MS, bridgeRequest, untilBridgeAnswers } from './hermes-team.ts';

export interface RoutineRequest extends Omit<AgentRoutinePayload, 'taskRef'> {
  idempotencyKey: string;
  // The routine's task: the one to reopen, or the one the routine created last. Plan
  // changes nothing while it is open.
  taskRef?: string;
  // The Plan user the task is created or reopened for.
  actorId?: string;
}

export interface PlanRoutineAdapter {
  dispatch(request: RoutineRequest): Promise<RoutineAnswer>;
}

export function routineIdempotencyKey(envelope: Pick<WorkEnvelope, 'eventId'>): string {
  return createHash('sha256').update(`agent-routine\0${envelope.eventId}`).digest('hex');
}

export const privatePlanRoutineAdapter: PlanRoutineAdapter = {
  async dispatch(input) {
    const raw = await untilBridgeAnswers(
      () => bridgeRequest('/internal/hermes/team/routine', { schemaVersion: 1, ...input }, 60_000),
      Date.now() + BRIDGE_OUTAGE_MS,
    );
    const answer = routineAnswerSchema.parse(raw);
    if (answer.idempotencyKey !== input.idempotencyKey) {
      throw new Error('Plan answered another routine request');
    }
    return answer;
  },
};
