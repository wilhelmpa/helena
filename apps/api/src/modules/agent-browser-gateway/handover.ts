import { db, approvalRequest } from '@repo/db';
import { and, eq, like } from 'drizzle-orm';
import { createApprovalRequest } from '#modules/approvals/service';
import type { RunnerAgent } from '../agents/runner/service';

// browser_handover's card in Helena's Freigaben (design §4: "Erzeugt eine Freigabe-Karte mit
// Link zur Live-Ansicht und wartet"). The owner sees it wherever they are, opens the
// project's browser from it, takes over, and gives control back — which closes the card
// (resolveHandoverCard) while the agent is still waiting. A card the agent stopped waiting
// for stays open: approving it later queues the agent's follow-up run, the usual way an
// approval continues a task.
export const HANDOVER_ACTION_PREFIX = 'Projekt-Browser: ';

export async function fileHandoverCard(
  agent: RunnerAgent,
  project: { id: number; key: string },
  reason: string,
): Promise<number> {
  const { approval } = await createApprovalRequest({
    projectId: project.id,
    agent: { id: agent.id, userId: agent.userId },
    kind: 'other',
    action: `${HANDOVER_ACTION_PREFIX}${reason}`.slice(0, 500),
    details: [
      `${agent.username} bittet darum, den Projekt-Browser zu übernehmen.`,
      `Live-Ansicht: /project/${project.key}?tool=browser`,
      'Dort „Übernehmen“ drücken, erledigen, dann „Zurückgeben“ – der Agent macht danach weiter.',
    ].join('\n'),
  });
  return approval.id;
}

// Closes a handover card the owner finished in the live view, without a follow-up run: the
// agent that asked is still waiting and carries on by itself. Only the gateway's own cards
// (kind other, the prefix above) can be closed this way.
export async function resolveHandoverCard(approvalId: number, finished: boolean): Promise<void> {
  if (!finished) return;
  await db
    .update(approvalRequest)
    .set({
      status: 'approved',
      decisionNote: 'Im Projekt-Browser erledigt und zurückgegeben.',
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(approvalRequest.id, approvalId),
        eq(approvalRequest.status, 'pending'),
        eq(approvalRequest.kind, 'other'),
        like(approvalRequest.action, `${HANDOVER_ACTION_PREFIX}%`),
      ),
    );
}
