import { db, agentRun, aiAgent, helenaPolicyDecision } from '@repo/db';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { AutopilotLevel } from '@helena/policy';
import { createComment } from '#modules/issues/activity';
import { levelName } from './engine';

// "Handeln & berichten": what an agent did without approval that a lower level would have
// asked a person for (deleting, risky commands, sending, publishing), listed on its task once
// the run ends.

const LISTED = 20;

export async function postAutopilotReport(runId: number): Promise<boolean> {
  const [run] = await db
    .select({
      issueId: agentRun.issueId,
      level: agentRun.autopilotLevel,
      agentUserId: aiAgent.userId,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(eq(agentRun.id, runId));
  if (!run) return false;
  const actions = await db
    .select({
      id: helenaPolicyDecision.id,
      category: helenaPolicyDecision.category,
      scope: helenaPolicyDecision.scope,
      summary: helenaPolicyDecision.summary,
      tool: helenaPolicyDecision.tool,
      level: helenaPolicyDecision.level,
    })
    .from(helenaPolicyDecision)
    .where(
      and(
        eq(helenaPolicyDecision.runId, runId),
        eq(helenaPolicyDecision.outcome, 'allow'),
        eq(helenaPolicyDecision.reason, 'level-allows'),
        notInArray(helenaPolicyDecision.category, ['read', 'report', 'write']),
        isNull(helenaPolicyDecision.reportedAt),
      ),
    )
    .orderBy(asc(helenaPolicyDecision.id));
  if (actions.length === 0) return false;
  await db
    .update(helenaPolicyDecision)
    .set({ reportedAt: new Date() })
    .where(
      inArray(
        helenaPolicyDecision.id,
        actions.map((action) => action.id),
      ),
    );
  if (run.issueId == null) return false;
  const level = (run.level ?? actions[0]!.level) as AutopilotLevel;
  const lines = actions.slice(0, LISTED).map((action) => {
    const where = action.scope === 'external' ? ' (outside the workspace)' : '';
    const what = (action.summary ?? action.tool ?? '').replace(/`/g, "'");
    return `- ${action.category}${where}: \`${what}\``;
  });
  if (actions.length > LISTED) lines.push(`- … and ${actions.length - LISTED} more`);
  await createComment({
    issueId: run.issueId,
    actorUserId: run.agentUserId,
    body: [
      `Autopilot report (level ${levelName(level)}): done without approval in this run:`,
      ...lines,
    ].join('\n'),
  });
  return true;
}
