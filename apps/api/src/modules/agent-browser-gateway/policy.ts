import type { ApprovalKind } from '#modules/approvals/service';
import { createApprovalRequest } from '#modules/approvals/service';
import type { RunnerAgent } from '../agents/runner/service';

// Helena's policy for one browser gateway call (docs/volition-helena-oss.md §3a "Richtlinien").
// The shapes are @helena/sdk's (hub/framework, packages/sdk/src/actions.ts and policy.ts):
// the action categories, and a decision with an effect and a reason. Once the SDK and
// hub/autopilot's policy engine are in the hub, decideBrowserAction becomes
// `decide(registry.policies, { agent, project, action: category, context })`; until then no
// policy applies and every call is allowed, as it always was.
export const ACTION_CATEGORIES = [
  'read',
  'write',
  'execute',
  'send',
  'delete',
  'publish',
  'pay',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

export interface BrowserActionContext {
  tool: string;
  // The page the call acts on and where a submitted form goes (origin and path only), the
  // element (its ref and the description the agent gave, Playwright MCP's `element`).
  origin: string | null;
  target: string | null;
  element: string | null;
  formAction: string | null;
}

export type PolicyEffect = 'allow' | 'needs-approval' | 'deny';

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  evaluator?: string;
}

export async function decideBrowserAction(
  _agent: RunnerAgent,
  _project: { id: number; key: string } | null,
  _category: ActionCategory,
  _context: BrowserActionContext,
): Promise<PolicyDecision> {
  return { effect: 'allow', reason: 'No policy applies', evaluator: 'default' };
}

// A call the policy wants approved first becomes a card in Freigaben; the owner's decision
// queues the agent's follow-up run, the way every approval continues a task.
const APPROVAL_KINDS: Partial<Record<ActionCategory, ApprovalKind>> = {
  send: 'send',
  publish: 'publish',
  pay: 'pay',
  delete: 'delete',
};

export async function fileBrowserApproval(
  agent: RunnerAgent,
  project: { id: number; key: string },
  category: ActionCategory,
  context: BrowserActionContext,
  reason: string,
): Promise<number> {
  const what = context.element ? ` „${context.element}“` : '';
  const where = context.formAction ?? context.origin ?? '';
  const { approval } = await createApprovalRequest({
    projectId: project.id,
    agent: { id: agent.id, userId: agent.userId },
    kind: APPROVAL_KINDS[category] ?? 'other',
    action: `Projekt-Browser: ${context.tool}${what}${where ? ` – ${where}` : ''}`.slice(0, 500),
    details: [
      reason,
      context.origin ? `Seite: ${context.origin}` : '',
      context.target ? `Element: ${context.target}` : '',
      `Live-Ansicht: /project/${project.key}?tool=browser`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return approval.id;
}
