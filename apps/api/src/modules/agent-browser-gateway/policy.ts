import type { RequestKind } from '#modules/approvals/service';
import { createApprovalRequest } from '#modules/approvals/service';
import type { RunnerAgent } from '../agents/runner/service';
import { approvalKindOf } from '@helena/policy';
import { decide } from '#modules/autopilot/engine';
import { AUTOPILOT_EVALUATOR_ID, decisionSentence } from '#modules/autopilot/evaluator';

// Helena's policy for one browser gateway call (docs/volition-helena-oss.md §3a "Richtlinien").
// The shapes are @helena/sdk's (hub/framework, packages/sdk/src/actions.ts and policy.ts):
// the action categories, and a decision with an effect and a reason. The decision is the
// Autopilot's (hub/autopilot, modules/autopilot/engine.ts); once the SDK's policy host is in
// the hub this becomes `decide(registry.policies, { agent, project, action: category,
// context })` with the Autopilot registered there.
// mirror of @helena/sdk ACTION_CATEGORIES (orchestrator decision D-C1), in rising risk.
export const ACTION_CATEGORIES = [
  'read',
  'report',
  'write',
  'send',
  'publish',
  'execute',
  'delete',
  'pay',
  'credentials',
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

// Asks Helena's policy engine (hub/autopilot): the Autopilot level of the project and the
// agent, the hard blocks and the budgets decide, and the decision is logged. The browser is
// outside the agent's workspace, so a delete or a script there counts as outside.
export async function decideBrowserAction(
  agent: RunnerAgent,
  project: { id: number; key: string } | null,
  category: ActionCategory,
  context: BrowserActionContext,
  work: { runId?: number | null; messageId?: number | null } = {},
): Promise<PolicyDecision> {
  const where = context.formAction ?? context.origin;
  const decision = await decide({
    adapter: 'gateway',
    agentId: agent.id,
    teamId: agent.teamId,
    projectId: project?.id ?? null,
    runId: work.runId ?? null,
    chatMessageId: work.messageId ?? null,
    category,
    scope: 'external',
    tool: context.tool,
    summary: [context.tool, context.element ?? context.target, where].filter(Boolean).join(' '),
  });
  return {
    effect: decision.outcome,
    reason: decisionSentence(decision),
    evaluator: AUTOPILOT_EVALUATOR_ID,
  };
}

// A call the policy wants approved first becomes a card in Freigaben, filed under the
// approval kind of its category; the owner's decision queues the agent's follow-up run, the
// way every approval continues a task.

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
    kind: approvalKindOf(category) as RequestKind,
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
