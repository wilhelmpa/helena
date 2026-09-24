import { db, aiAgent, helenaBudget } from '@repo/db';
import { and, eq, isNotNull } from 'drizzle-orm';

// A template's Autopilot settings travel to its copies: the level with its raise flag
// (the 'approvals' template group) and the agent's own budgets (the 'budgets' group). Kept
// free of the agents module so its services can call it without an import cycle.

export async function copyAgentLevel(fromAgentId: number, toAgentId: number): Promise<void> {
  const [from] = await db
    .select({ level: aiAgent.autopilotLevel, raise: aiAgent.autopilotRaise })
    .from(aiAgent)
    .where(eq(aiAgent.id, fromAgentId));
  if (!from) return;
  await db
    .update(aiAgent)
    .set({ autopilotLevel: from.level, autopilotRaise: from.raise })
    .where(eq(aiAgent.id, toAgentId));
}

// Replaces the copy's own budgets with the template's. Warnings, reached limits and
// "continue once" belong to the copy's own spending and start fresh.
export async function copyAgentBudgets(fromAgentId: number, toAgentId: number): Promise<void> {
  const budgets = await db
    .select({
      teamId: helenaBudget.teamId,
      metric: helenaBudget.metric,
      period: helenaBudget.period,
      limitValue: helenaBudget.limitValue,
    })
    .from(helenaBudget)
    .where(and(eq(helenaBudget.agentId, fromAgentId), isNotNull(helenaBudget.agentId)));
  await db.transaction(async (tx) => {
    await tx.delete(helenaBudget).where(eq(helenaBudget.agentId, toAgentId));
    if (budgets.length > 0) {
      await tx
        .insert(helenaBudget)
        .values(budgets.map((budget) => ({ ...budget, agentId: toAgentId })));
    }
  });
}
