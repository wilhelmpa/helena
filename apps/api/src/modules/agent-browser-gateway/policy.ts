import type { ApprovalKind } from '#modules/approvals/service';
import { createApprovalRequest } from '#modules/approvals/service';
import type { RunnerAgent } from '../agents/runner/service';

// What a browser gateway call does to the world (the gateway's tools carry it as their
// action category, docs/volition-helena-oss.md §3a "Agenten-Werkzeuge"), and the one place
// Helena decides on such a call ("Richtlinien"). The policy engine of hub/autopilot,
// decide(agent, project, actionCategory, context), takes this place once it is in Helena;
// until then every browser action is allowed, as it always was.
export const ACTION_CATEGORIES = [
  'read',
  'write',
  'send',
  'publish',
  'delete',
  'pay',
  'execute',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

export interface BrowserActionContext {
  tool: string;
  // The page the call acts on, and where a submitted form goes: origin and path only.
  origin: string | null;
  target: string | null;
  formAction: string | null;
}

export type BrowserDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'approve'; reason?: string };

export async function decideBrowserAction(
  _agent: RunnerAgent,
  _project: { id: number; key: string } | null,
  _category: ActionCategory,
  _context: BrowserActionContext,
): Promise<BrowserDecision> {
  return { decision: 'allow' };
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
  reason?: string,
): Promise<number> {
  const where = context.formAction ?? context.target ?? context.origin ?? '';
  const { approval } = await createApprovalRequest({
    projectId: project.id,
    agent: { id: agent.id, userId: agent.userId },
    kind: APPROVAL_KINDS[category] ?? 'other',
    action: `Projekt-Browser: ${context.tool}${where ? ` – ${where}` : ''}`.slice(0, 500),
    details: [
      reason ?? '',
      context.origin ? `Seite: ${context.origin}` : '',
      `Live-Ansicht: /project/${project.key}?tool=browser`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return approval.id;
}
