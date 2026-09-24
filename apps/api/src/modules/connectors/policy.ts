import {
  decide,
  type ActionCategory,
  type PolicyDecision,
  type PolicyEvaluator,
  type PolicyRequest,
} from '@helena/connectors';

// The policy seam for connector actions: may this agent take an action of this category
// with this account here? Evaluators are composed and the strictest answer wins
// (@helena/sdk's `decide`). Two ship with the access center:
//
//   - 'access-center.grants' denies what no grant covers, and anything but reading on a
//     read-only grant. It stays whatever else is registered.
//   - 'access-center.defaults' sends every action that reaches outside Helena (send,
//     publish, pay) or removes something (delete) to the owner for approval. It stands in
//     for the autopilot (hub/autopilot), which removes it with `replaceDefaultPolicy` when
//     it registers its own evaluator for the levels per project and agent.

export const grantEvaluator: PolicyEvaluator = {
  id: 'access-center.grants',
  evaluate(request) {
    const grant = request.context.grant;
    if (!grant) {
      return { effect: 'deny', reason: 'This account is not granted to you.' };
    }
    if (grant.access === 'read' && request.action !== 'read') {
      return { effect: 'deny', reason: 'You may only read with this account.' };
    }
    return null;
  },
};

const NEEDS_APPROVAL: readonly ActionCategory[] = ['send', 'publish', 'pay', 'delete', 'execute'];

export const defaultApprovalEvaluator: PolicyEvaluator = {
  id: 'access-center.defaults',
  evaluate(request) {
    return NEEDS_APPROVAL.includes(request.action)
      ? { effect: 'needs-approval', reason: `A ${request.action} action waits for the owner.` }
      : null;
  },
};

const evaluators: PolicyEvaluator[] = [grantEvaluator, defaultApprovalEvaluator];

// Adds an evaluator; returns the function that removes it.
export function registerPolicyEvaluator(evaluator: PolicyEvaluator): () => void {
  evaluators.push(evaluator);
  return () => {
    const index = evaluators.indexOf(evaluator);
    if (index >= 0) evaluators.splice(index, 1);
  };
}

// For the autopilot: its evaluator takes the place of the default approvals. The grant
// check stays in front of it.
export function replaceDefaultPolicy(evaluator: PolicyEvaluator): () => void {
  const index = evaluators.indexOf(defaultApprovalEvaluator);
  if (index >= 0) evaluators.splice(index, 1);
  const remove = registerPolicyEvaluator(evaluator);
  return () => {
    remove();
    if (!evaluators.includes(defaultApprovalEvaluator)) evaluators.push(defaultApprovalEvaluator);
  };
}

export function decideConnectorAction(request: PolicyRequest): Promise<PolicyDecision> {
  return decide(evaluators, request);
}
