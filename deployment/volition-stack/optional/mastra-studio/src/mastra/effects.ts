import { createHash } from 'node:crypto';
import type { Effect, WorkEnvelope } from './contracts.ts';

export type EffectSpec = Pick<Effect, 'kind' | 'target' | 'description'>;

export function idempotencyKey(
  envelope: Pick<WorkEnvelope, 'eventId' | 'correlationId'>,
  workflowId: string,
  target: string,
): string {
  return createHash('sha256')
    .update(`${workflowId}\0${envelope.eventId}\0${envelope.correlationId}\0${target}`)
    .digest('hex');
}

export function planEffects(
  envelope: WorkEnvelope,
  workflowId: string,
  specs: readonly EffectSpec[],
): Effect[] {
  return specs.map(spec => {
    const key = idempotencyKey(envelope, workflowId, spec.target);
    const requiresApproval = spec.kind === 'external-write' || spec.kind === 'external-send';
    return {
      ...spec,
      id: `effect_${key.slice(0, 20)}`,
      idempotencyKey: key,
      requiresApproval,
      status: envelope.dryRun ? 'simulated' : requiresApproval ? 'blocked' : 'planned',
    };
  });
}

export function approvalEffects(effects: readonly Effect[]): Effect[] {
  return effects.filter(effect => effect.requiresApproval);
}
