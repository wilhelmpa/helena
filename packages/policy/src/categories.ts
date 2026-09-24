// The kinds of action the policy engine decides on (docs/helena-decisions/policy-engine.md,
// orchestrator decision D-C1), in rising risk. Every tool, connector, workflow step and
// runtime maps what it is about to do onto one of these, and the Autopilot level of the
// project and the agent decides the rest.
// mirror of @helena/sdk ACTION_CATEGORIES: import it from there once hub/framework lands.
export const ACTION_CATEGORIES = [
  // Look at something: files, Helena data, web pages, mail.
  'read',
  // Post status or results into Helena itself: comment on its own task, ask, report
  // blocked, request an approval, the run report. Always allowed, so an agent that may only
  // propose can still propose.
  'report',
  // Change Helena data or files in the agent's own workspace.
  'write',
  // Reach people or systems outside Helena: mail, messages, webhooks, form submissions,
  // uploads, third-party tools.
  'send',
  // Make something public or live: push, release, deploy, publish a package.
  'publish',
  // Run risky code or commands. `scope` says whether they stay in the workspace.
  'execute',
  // Remove something. `scope` says whether it is inside the workspace or outside.
  'delete',
  // Spend money.
  'pay',
  // Any change to logins, keys, tokens or grants. Always a person's decision.
  'credentials',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

// Where an action lands: inside the agent's own workspace (its project folder, its
// project's data in Helena) or outside it (the system, other projects, the internet).
export type ActionScope = 'workspace' | 'external';

// The risk rank of a category: its place in ACTION_CATEGORIES.
// mirror of @helena/sdk actionRank()
export function actionRank(category: ActionCategory): number {
  return ACTION_CATEGORIES.indexOf(category);
}

// The MCP tool annotations a tool of this category carries (D-C1).
// mirror of @helena/sdk annotationsForCategory()
export function annotationsForCategory(category: ActionCategory): {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
} {
  switch (category) {
    case 'read':
      return { readOnlyHint: true, destructiveHint: false };
    case 'report':
    case 'write':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    case 'send':
    case 'publish':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
    case 'delete':
      return { readOnlyHint: false, destructiveHint: true };
    case 'execute':
    case 'pay':
    case 'credentials':
      return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
  }
}

// The `_meta` key a tool declares its category under.
export const ACTION_META_KEY = 'helena/action';

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

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
