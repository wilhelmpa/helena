import type { ActionCategory, ActionScope } from './actions';
import type { AgentRef, ProjectRef } from './common';

// One question for every tool call, connector service, workflow step and runtime
// permission request: may this agent do this kind of action here? The request has the
// shape of an authorization request in Cedar or CASL (principal = agent, action =
// category, resource = project, plus context), so an evaluator can be written with either.
//
// Evaluators are composed, never overridden: every registered evaluator is asked, the
// strictest answer wins (deny over needs-approval over allow), and an evaluator that has
// no opinion abstains. When all abstain, the action is allowed, which is how Helena
// behaved before policies existed.

export interface PolicyContext {
  // What is being done, for the evaluator and the approval card.
  tool?: string;
  connector?: string;
  service?: string;
  stepType?: string;
  runtime?: string;
  // A human-readable target: a mail recipient, a URL, a command.
  target?: string;
  amount?: { value: number; currency: string };
  runId?: number | null;
  issueId?: number | null;
  input?: unknown;
  // Where a delete or an execute lands. Absent, an evaluator assumes outside.
  scope?: ActionScope;
}

export interface PolicyRequest {
  agent: AgentRef | null;
  project: ProjectRef | null;
  action: ActionCategory;
  context: PolicyContext;
}

export type PolicyEffect = 'allow' | 'needs-approval' | 'deny';

export interface PolicyDecision {
  effect: PolicyEffect;
  // Why, in a sentence a person reads on the approval card or in the run log.
  reason: string;
  // The evaluator that decided.
  evaluator?: string;
}

export interface PolicyEvaluator {
  id: string;
  evaluate(request: PolicyRequest): PolicyDecision | null | Promise<PolicyDecision | null>;
}

const STRICTNESS: Record<PolicyEffect, number> = { allow: 0, 'needs-approval': 1, deny: 2 };

export const DEFAULT_DECISION: PolicyDecision = {
  effect: 'allow',
  reason: 'No policy applies',
  evaluator: 'default',
};

// Asks every evaluator and returns the strictest decision. An evaluator that throws
// denies: a broken policy must not open what it was meant to guard.
export async function decide(
  evaluators: Iterable<PolicyEvaluator>,
  request: PolicyRequest,
): Promise<PolicyDecision> {
  let result: PolicyDecision | null = null;
  for (const evaluator of evaluators) {
    let decision: PolicyDecision | null;
    try {
      decision = await evaluator.evaluate(request);
    } catch (error) {
      decision = {
        effect: 'deny',
        reason: `Policy ${evaluator.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!decision) continue;
    const stamped = { ...decision, evaluator: decision.evaluator ?? evaluator.id };
    if (!result || STRICTNESS[stamped.effect] > STRICTNESS[result.effect]) result = stamped;
    if (result.effect === 'deny') break;
  }
  return result ?? DEFAULT_DECISION;
}
