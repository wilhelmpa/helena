import type { ActionCategory, ActionScope } from './categories';
import type { AutopilotLevel } from './levels';
import type { ReasonCode } from './policies';

// The Autopilot's inner evaluation of "may this agent do this kind of thing here?", with
// every fact already worked out; the Cedar evaluator (cedar.ts) implements it. The API
// wraps it as an @helena/sdk PolicyEvaluator ("Richtlinien", volition-helena-oss.md §3a),
// which the framework's policy host asks with the other registered evaluators.

// What the evaluator is asked. The facts that need the database (which level applies,
// whether a budget is used up, whether a person approved exactly this action) are worked
// out by the caller, the API's autopilot module, and passed in.
export interface PolicyRequest {
  agentId: number | null;
  projectId: number | null;
  category: ActionCategory;
  scope: ActionScope;
  level: AutopilotLevel;
  // A person approved exactly this action.
  approved?: boolean;
  // A budget of the agent or the project is used up for the current period.
  budgetExhausted?: boolean;
}

export type PolicyOutcome = 'allow' | 'needs-approval' | 'deny';

export interface PolicyDecision {
  outcome: PolicyOutcome;
  reason: ReasonCode;
  // The ids of the policies that decided: permits for an allow, forbids for a deny or an
  // approval a hard block asks for, none when nothing permits the action at this level.
  policyIds: string[];
  // The reason an extra policy (from a plugin or the owner) gives for itself.
  detail?: string;
}

// Policies a plugin (or later the owner) adds to the set, each with the reason it gives.
export interface ExtraPolicy {
  id: string;
  text: string;
  reason: string;
}

export interface PolicyEvaluator {
  evaluate(request: PolicyRequest): PolicyDecision;
  // Adds policies to the set after checking them against the schema. Throws with the
  // checker's messages when one does not validate.
  addPolicies(source: string, policies: ExtraPolicy[]): void;
}
