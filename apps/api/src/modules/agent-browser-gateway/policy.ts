import {
  renewalDomainApproved,
  renewalDomainInPath,
  browserApprovalCommand,
} from './contract-approval';
import { db, agentRun, approvalRequest } from '@repo/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { ActionCategory, PolicyDecision } from '@helena/sdk';
import type { RequestKind } from '#modules/approvals/service';
import { createApprovalRequest } from '#modules/approvals/service';
import type { RunnerAgent } from '../agents/runner/service';
import { approvalKindOf } from '@helena/policy';
import { decide } from '#modules/autopilot/engine';
import { AUTOPILOT_EVALUATOR_ID, decisionSentence } from '#modules/autopilot/evaluator';

// Helena's policy for one browser gateway call (docs/volition-helena-oss.md §3a "Richtlinien"),
// in @helena/sdk's shapes: the action categories (D-C1) and a decision with an effect and a
// reason. The decision is the Autopilot's (modules/autopilot/engine.ts), asked directly
// rather than through the plugin host, so the log keeps the chat message a call came from.
export { isActionCategory, type ActionCategory } from '@helena/sdk';

export interface BrowserActionContext {
  tool: string;
  // The page the call acts on and where a submitted form goes (origin and path only), the
  // element (its ref and the description the agent gave, Playwright MCP's `element`).
  origin: string | null;
  target: string | null;
  element: string | null;
  formAction: string | null;
  // Observed by the browser process, not supplied by the agent's element description.
  groundedElement: string | null;
  pagePath: string | null;
}

// A legacy free-text approval can authorize the exact domain cancellation only when the
// same agent is still working on the same issue, within a day, on Squarespace. An approval
// for one domain never authorizes another domain or a different operation.

async function approvedRenewalRequest(
  agentId: number,
  projectId: number | null,
  runId: number | null | undefined,
  context: BrowserActionContext,
): Promise<number | null> {
  if (projectId == null || runId == null || !context.pagePath || !context.groundedElement)
    return null;
  try {
    const hostname = new URL(context.origin ?? '').hostname.toLowerCase();
    if (hostname !== 'squarespace.com' && !hostname.endsWith('.squarespace.com')) return null;
  } catch {
    return null;
  }
  const [run] = await db
    .select({ issueId: agentRun.issueId })
    .from(agentRun)
    .where(
      and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId), eq(agentRun.projectId, projectId)),
    );
  if (!run?.issueId) return null;
  const rows = await db
    .select({
      id: approvalRequest.id,
      action: approvalRequest.action,
      status: approvalRequest.status,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.agentId, agentId),
        eq(approvalRequest.projectId, projectId),
        eq(approvalRequest.issueId, run.issueId),
        eq(approvalRequest.kind, 'delete'),
        gt(approvalRequest.decidedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(approvalRequest.id))
    .limit(30);
  const latest = rows.find((row) =>
    renewalDomainApproved(row.action, context.pagePath, context.groundedElement),
  );
  return latest?.status === 'approved' ? latest.id : null;
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
  const approvedRequestId =
    category === 'delete' && context.tool.startsWith('browser_')
      ? await approvedRenewalRequest(agent.id, project?.id ?? null, work.runId, context)
      : null;
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
    summary: [
      context.tool,
      context.element ?? context.target,
      where,
      approvedRequestId ? 'approved #' + approvedRequestId : null,
    ]
      .filter(Boolean)
      .join(' '),
    approvedByTask: approvedRequestId !== null,
    command: browserApprovalCommand(category, context),
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
  const domain =
    category === 'delete' &&
    context.groundedElement &&
    renewalDomainApproved(
      'Automatische Verlängerung für ' + renewalDomainInPath(context.pagePath) + ' deaktivieren',
      context.pagePath,
      context.groundedElement,
    )
      ? renewalDomainInPath(context.pagePath)
      : null;
  const action = domain
    ? 'Automatische Verlängerung für ' + domain + ' deaktivieren'
    : 'Projekt-Browser: ' + context.tool + what + (where ? ' – ' + where : '');
  const { approval } = await createApprovalRequest({
    projectId: project.id,
    agent: { id: agent.id, userId: agent.userId },
    kind: approvalKindOf(category) as RequestKind,
    action: action.slice(0, 500),
    command: browserApprovalCommand(category, context) ?? undefined,
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
