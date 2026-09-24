// The Autopilot as a Cedar policy set (https://www.cedarpolicy.com). One request per action:
// the principal is the agent, the resource the project it works in, the action the action
// category, and the context carries what the engine worked out beforehand: the level that
// applies, where the action lands, whether a person approved it and whether a budget is used
// up. Cedar denies by default, so a category a level does not permit needs approval.
//
// Every policy has an id; the engine turns the ids that determined a decision into the
// reason shown on approval cards and in the audit log (see REASON_BY_POLICY).

export const CEDAR_NAMESPACE = 'Helena';

export const AUTOPILOT_SCHEMA = `
namespace Helena {
  entity Agent;
  entity Project;
  type Situation = {
    level: Long,
    scope: String,
    approved: Bool,
    budgetExhausted: Bool,
  };
  action read, report, write, send, delete, pay, publish, execute, credentials appliesTo {
    principal: [Agent],
    resource: [Project],
    context: Situation,
  };
}
`;

const A = (category: string) => `Helena::Action::"${category}"`;

export const AUTOPILOT_POLICIES: Record<string, string> = {
  // Reading and talking within the task need nobody, at every level: an agent that may
  // only propose has to be able to read and to propose.
  'always-read-report': `permit(principal, action in [${A('read')}, ${A('report')}], resource);`,

  // Level 1 changes Helena and its own workspace.
  'level1-write': `permit(principal, action == ${A('write')}, resource)
    when { context.level >= 1 };`,

  // Level 2 also deletes and runs risky commands, as long as they stay in its workspace.
  'level2-workspace': `permit(principal, action in [${A('delete')}, ${A('execute')}], resource)
    when { context.level >= 2 && context.scope == "workspace" };`,

  // Level 3 does everything within the budget, except what the hard blocks below keep back.
  'level3-all': `permit(principal, action, resource) when { context.level >= 3 };`,

  // What a person approved may go ahead, at every level.
  approved: `permit(principal, action, resource) when { context.approved };`,

  // Hard blocks: always a person's decision, even at level 3.
  'hard-pay': `forbid(principal, action == ${A('pay')}, resource) unless { context.approved };`,
  'hard-credentials': `forbid(principal, action == ${A('credentials')}, resource)
    unless { context.approved };`,
  'hard-delete-external': `forbid(principal, action == ${A('delete')}, resource)
    when { context.scope == "external" } unless { context.approved };`,

  // A used-up budget stops everything but reading and talking, approval or not: only the
  // owner raising the budget or letting the work continue once lifts it.
  'budget-exhausted': `forbid(principal, action, resource)
    when { context.budgetExhausted } unless { action in [${A('read')}, ${A('report')}] };`,
};

// Why a decision came out as it did, as a code the UI translates (autopilot.reason.<code>)
// and the agent reads in English (see REASON_TEXT).
export type ReasonCode =
  | 'always-allowed'
  | 'level-allows'
  | 'approved'
  | 'level-requires-approval'
  | 'hard-block'
  | 'budget-exhausted'
  | 'policy';

export const REASON_BY_POLICY: Record<string, ReasonCode> = {
  'always-read-report': 'always-allowed',
  'level1-write': 'level-allows',
  'level2-workspace': 'level-allows',
  'level3-all': 'level-allows',
  approved: 'approved',
  'hard-pay': 'hard-block',
  'hard-credentials': 'hard-block',
  'hard-delete-external': 'hard-block',
  'budget-exhausted': 'budget-exhausted',
};
