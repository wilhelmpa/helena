import type { ActionCategory, ActionScope } from '@helena/sdk';

// The kinds of action the policy engine decides on (docs/helena-decisions/policy-engine.md,
// orchestrator decision D-C1), in rising risk, and where an action lands: @helena/sdk's
// vocabulary, which every tool, connector, workflow step and runtime maps what it is about
// to do onto. The Autopilot level of the project and the agent decides the rest.
//
//   read         look at something: files, Helena data, web pages, mail
//   report       post status or results into Helena itself (comment on its own task, ask,
//                report blocked, request an approval, the run report); always allowed, so
//                an agent that may only propose can still propose
//   write        change Helena data or files in the agent's own workspace
//   send         reach people or systems outside Helena: mail, messages, webhooks, form
//                submissions, uploads, third-party tools
//   publish      make something public or live: push, release, deploy, publish a package
//   execute      run risky code or commands; the scope says whether they stay inside
//   delete       remove something; the scope says whether it is inside the workspace
//   pay          spend money
//   credentials  any change to logins, keys, tokens or grants; always a person's decision
export {
  ACTION_CATEGORIES,
  ACTION_META_KEY,
  actionRank,
  annotationsForCategory,
  isActionCategory,
  type ActionCategory,
  type ActionScope,
} from '@helena/sdk';
// The categories a person always approves, whatever the level: paying, deleting outside
// the workspace and changing credentials.
export function isHardBlocked(category: ActionCategory, scope: ActionScope): boolean {
  return (
    category === 'pay' ||
    category === 'credentials' ||
    (category === 'delete' && scope === 'external')
  );
}

// What the approval request of an action is filed as. The approval kinds are the
// categories a person decides on.
export type ApprovalKind =
  'send' | 'publish' | 'pay' | 'delete' | 'write' | 'execute' | 'credentials' | 'budget' | 'other';

export function approvalKindOf(category: ActionCategory): ApprovalKind {
  return category === 'read' || category === 'report' ? 'other' : category;
}

// The category an approval request of this kind is about ('other' asks for anything the
// agent could not name, which counts as an outward action).
export function categoryOfApprovalKind(kind: ApprovalKind): ActionCategory {
  return kind === 'other' || kind === 'budget' ? 'send' : kind;
}
