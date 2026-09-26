import { db, aiAgent, project } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import {
  budgetReason,
  budgetStatuses,
  enforceBudgets,
  noticeRecipients,
  setBudgets,
} from '#modules/autopilot/budgets';
import { periodStart, usageSince } from '#modules/autopilot/usage';
import { onTemplateRelevantChange } from './core/template-sync';

// Whether an agent takes work: a member can pause it by hand, and its budgets and its
// project's budgets (Helena's Autopilot, modules/autopilot/budgets.ts) stop it when they
// are used up. A paused agent's queued runs and chat answers wait, and nothing new starts
// it. The token ceilings of the Organization page are the agent's and the project's token
// budgets; days and months are UTC.

export { noticeRecipients };

export interface TokenUsage {
  today: number;
  month: number;
}

// The tokens the agents used today and this month.
export async function agentTokenUsage(agentIds: number[]): Promise<Map<number, TokenUsage>> {
  if (agentIds.length === 0) return new Map();
  const [today, month] = await Promise.all([
    usageSince('agent', agentIds, periodStart('day')),
    usageSince('agent', agentIds, periodStart('month')),
  ]);
  return new Map(
    agentIds.map((id) => [
      id,
      { today: today.get(id)?.tokens ?? 0, month: month.get(id)?.tokens ?? 0 },
    ]),
  );
}

// The tokens the agents of each project used this month.
export async function projectTokenUsage(projectIds: number[]): Promise<Map<number, number>> {
  if (projectIds.length === 0) return new Map();
  const month = await usageSince('project', projectIds, periodStart('month'));
  return new Map(projectIds.map((id) => [id, month.get(id)?.tokens ?? 0]));
}

// Enforces the pause and the budgets on work of the agent in the project: the reason the
// agent may not start it, or null when it may. A budget found used up stops the work and
// tells the owner of the budget on the issue the work was for (see enforceBudgets).
export async function enforceAgentLimits(
  agentId: number,
  projectId: number,
  issueId: number | null,
): Promise<string | null> {
  const [agent] = await db
    .select({ pausedAt: aiAgent.pausedAt, pauseReason: aiAgent.pauseReason })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) return null;
  if (agent.pausedAt) return agent.pauseReason ?? 'The agent is paused.';
  return enforceBudgets(agentId, projectId, issueId);
}

// Pauses the agent by hand. The reason replaces the one it was paused for. False when
// the team has no such agent.
export async function pauseAgent(
  teamId: number,
  agentId: number,
  reason: string,
): Promise<boolean> {
  const rows = await db
    .update(aiAgent)
    .set({ pausedAt: sql`coalesce(${aiAgent.pausedAt}, now())`, pauseReason: reason })
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
    .returning({ id: aiAgent.id });
  return rows.length > 0;
}

// Lets the agent take work again. Refused while one of its own budgets is still used up,
// which would pause it again at its next run. A project's budget does not hold the agent
// back here: the agent may work in the team's other projects.
export async function resumeAgent(teamId: number, agentId: number): Promise<boolean> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) return false;
  const reached = (await budgetStatuses({ agentIds: [agentId] })).find(
    (status) => status.reached && status.graceRuns === 0,
  );
  if (reached) {
    throw new HttpError(
      409,
      `${budgetReason(reached)} Raise the budget or let the agent continue once to resume it.`,
    );
  }
  await db
    .update(aiAgent)
    .set({ pausedAt: null, pauseReason: null })
    .where(eq(aiAgent.id, agentId));
  return true;
}

export async function setAgentTokenCeilings(
  teamId: number,
  agentId: number,
  ceilings: { daily: number | null; monthly: number | null },
  deciderUserId: string | null = null,
): Promise<boolean> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) return false;
  await setBudgets(
    teamId,
    { agentId },
    [
      { metric: 'tokens', period: 'day', limit: ceilings.daily },
      { metric: 'tokens', period: 'month', limit: ceilings.monthly },
    ],
    deciderUserId,
  );
  await onTemplateRelevantChange(agentId, ['budgets']);
  return true;
}

export async function setProjectTokenCeiling(
  teamId: number,
  projectId: number,
  monthly: number | null,
  deciderUserId: string | null = null,
): Promise<boolean> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  if (!row) return false;
  await setBudgets(
    teamId,
    { projectId },
    [{ metric: 'tokens', period: 'month', limit: monthly }],
    deciderUserId,
  );
  return true;
}
