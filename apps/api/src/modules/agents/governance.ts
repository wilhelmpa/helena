import { db, agentRun, aiAgent, project, projectMember, user } from '@repo/db';
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { createComment } from '#modules/issues/activity';

// What an agent may spend and whether it takes work. A paused agent's queued runs and
// chat answers wait, and nothing new starts it. The token ceilings count what the
// agent's runs read and wrote (agent_run input and output tokens). A chat answer
// reports only the size of its context, which is not what it cost, so chats are not
// counted. Days and months are UTC.

const dayStart = sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`;
const monthStart = sql`date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`;
const runTokens = sql`coalesce(${agentRun.inputTokens}, 0) + coalesce(${agentRun.outputTokens}, 0)`;

export interface TokenUsage {
  today: number;
  month: number;
}

// The tokens the agents' runs used today and this month.
export async function agentTokenUsage(agentIds: number[]): Promise<Map<number, TokenUsage>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db
    .select({
      agentId: agentRun.agentId,
      today: sql<number>`coalesce(sum(${runTokens}) filter (where ${agentRun.finishedAt} >= ${dayStart}), 0)::float8`,
      month: sql<number>`coalesce(sum(${runTokens}), 0)::float8`,
    })
    .from(agentRun)
    .where(and(inArray(agentRun.agentId, agentIds), gte(agentRun.finishedAt, monthStart)))
    .groupBy(agentRun.agentId);
  return new Map(rows.map((row) => [row.agentId, { today: row.today, month: row.month }]));
}

// The tokens the agent runs of each project used this month.
export async function projectTokenUsage(projectIds: number[]): Promise<Map<number, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: agentRun.projectId,
      month: sql<number>`coalesce(sum(${runTokens}), 0)::float8`,
    })
    .from(agentRun)
    .where(and(inArray(agentRun.projectId, projectIds), gte(agentRun.finishedAt, monthStart)))
    .groupBy(agentRun.projectId);
  return new Map(rows.map((row) => [row.projectId, row.month]));
}

const count = (value: number) => value.toLocaleString('en-US');

interface AgentCeilings {
  id: number;
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
}

// The agent's own ceiling it has reached, as the reason it is paused for, or null.
async function reachedAgentCeiling(agent: AgentCeilings): Promise<string | null> {
  if (agent.dailyTokenCeiling == null && agent.monthlyTokenCeiling == null) return null;
  const usage = (await agentTokenUsage([agent.id])).get(agent.id) ?? { today: 0, month: 0 };
  if (agent.dailyTokenCeiling != null && usage.today >= agent.dailyTokenCeiling)
    return `Daily token ceiling reached: ${count(usage.today)} of ${count(agent.dailyTokenCeiling)} tokens used today (UTC).`;
  if (agent.monthlyTokenCeiling != null && usage.month >= agent.monthlyTokenCeiling)
    return `Monthly token ceiling reached: ${count(usage.month)} of ${count(agent.monthlyTokenCeiling)} tokens used this month (UTC).`;
  return null;
}

async function reachedProjectCeiling(projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ key: project.key, ceiling: project.monthlyTokenCeiling })
    .from(project)
    .where(eq(project.id, projectId));
  if (row?.ceiling == null) return null;
  const used = (await projectTokenUsage([projectId])).get(projectId) ?? 0;
  if (used < row.ceiling) return null;
  return `Monthly token ceiling of project ${row.key} reached: ${count(used)} of ${count(row.ceiling)} tokens used this month (UTC).`;
}

// Who a notice about an agent on an issue of the project goes to, as the handles a
// comment mentions them by: the preferred person while they are a member of the
// project, otherwise the project's owners.
export async function noticeRecipients(
  projectId: number,
  preferredUserId: string | null,
): Promise<string[]> {
  const members = await db
    .select({ id: user.id, username: user.username, role: projectMember.role })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(and(eq(projectMember.projectId, projectId), isNotNull(user.username)));
  const preferred = members.find((member) => member.id === preferredUserId);
  const recipients = preferred ? [preferred] : members.filter((m) => m.role === 'owner');
  return recipients.map((member) => `@${member.username}`);
}

// Pauses the agent unless it already is. True when this call paused it.
async function pause(agentId: number, reason: string): Promise<boolean> {
  const rows = await db
    .update(aiAgent)
    .set({ pausedAt: new Date(), pauseReason: reason })
    .where(and(eq(aiAgent.id, agentId), isNull(aiAgent.pausedAt)))
    .returning({ id: aiAgent.id });
  return rows.length > 0;
}

// Enforces the pause and the token ceilings on work of the agent in the project: the
// reason the agent may not start it, or null when it may. A ceiling found reached
// pauses the agent, and the owner of that ceiling is told on the issue the work was
// for: the agent's owner for its own ceilings, the project's owners for the project's.
// Work without an issue has nowhere to say it; the pause shows on the agent.
export async function enforceAgentLimits(
  agentId: number,
  projectId: number,
  issueId: number | null,
): Promise<string | null> {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      ownerUserId: aiAgent.ownerUserId,
      pausedAt: aiAgent.pausedAt,
      pauseReason: aiAgent.pauseReason,
      dailyTokenCeiling: aiAgent.dailyTokenCeiling,
      monthlyTokenCeiling: aiAgent.monthlyTokenCeiling,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) return null;
  if (agent.pausedAt) return agent.pauseReason ?? 'The agent is paused.';
  const own = await reachedAgentCeiling(agent);
  const reason = own ?? (await reachedProjectCeiling(projectId));
  if (!reason) return null;
  if ((await pause(agent.id, reason)) && issueId != null) {
    const handles = await noticeRecipients(projectId, own ? agent.ownerUserId : null);
    await createComment({
      issueId,
      actorUserId: agent.userId,
      body: [
        ...handles,
        `I am paused and take no new work. ${reason}`,
        'Raise the ceiling and resume me on the Organization page to let me continue.',
      ].join(' '),
    });
  }
  return reason;
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

// Lets the agent take work again. Refused while one of its own ceilings is still
// reached, which would pause it again at its next run. A project's ceiling does not
// hold the agent back here: the agent may work in the team's other projects.
export async function resumeAgent(teamId: number, agentId: number): Promise<boolean> {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      dailyTokenCeiling: aiAgent.dailyTokenCeiling,
      monthlyTokenCeiling: aiAgent.monthlyTokenCeiling,
    })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) return false;
  const reached = await reachedAgentCeiling(agent);
  if (reached) throw new HttpError(409, `${reached} Raise the ceiling to resume the agent.`);
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
): Promise<boolean> {
  const rows = await db
    .update(aiAgent)
    .set({ dailyTokenCeiling: ceilings.daily, monthlyTokenCeiling: ceilings.monthly })
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
    .returning({ id: aiAgent.id });
  return rows.length > 0;
}

export async function setProjectTokenCeiling(
  teamId: number,
  projectId: number,
  monthly: number | null,
): Promise<boolean> {
  const rows = await db
    .update(project)
    .set({ monthlyTokenCeiling: monthly })
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .returning({ id: project.id });
  return rows.length > 0;
}
