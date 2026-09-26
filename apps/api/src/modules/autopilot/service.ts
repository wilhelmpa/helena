import {
  db,
  agentChatMessage,
  agentChatThread,
  agentRun,
  aiAgent,
  approvalRequest,
  helenaPolicyDecision,
  helenaBudget,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import {
  classifyToolCall,
  effectiveLevel,
  isAutopilotLevel,
  type ActionCategory,
  type AutopilotLevel,
  type ToolAnnotations,
} from '@helena/policy';
import { requireTeamMembership } from '#shared/access';
import { runsTeam } from '#modules/teams/service';
import { HttpError, iso } from '#shared/lib';
import type { RunnerAgent } from '#modules/agents/runner/service';
import {
  budgetStatuses,
  continueOnce,
  getBudget,
  settleBudgets,
  type BudgetStatus,
  type BudgetTarget,
} from './budgets';
import { allLevelRules, decide, type EngineDecision } from './engine';
import { resolveLevel } from './levels';
import { periodStart, usageSince, type UsageTotals } from './usage';

// The Autopilot's views and the routes' work: the project's level and budgets, an agent's
// effective level and remaining budget, the decision log, the owner's answer on a budget
// card, and the decisions a runtime asks for.

export async function projectAutopilot(projectId: number) {
  const [row] = await db
    .select({ level: project.autopilotLevel })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new HttpError(404, 'Project not found');
  const projectLevel = row.level as AutopilotLevel;
  const agents = await db
    .select({
      id: aiAgent.id,
      name: user.name,
      username: aiAgent.username,
      agentLevel: aiAgent.autopilotLevel,
      raise: aiAgent.autopilotRaise,
      pausedAt: aiAgent.pausedAt,
    })
    .from(projectMember)
    .innerJoin(aiAgent, eq(aiAgent.userId, projectMember.userId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(user.name));
  return {
    level: projectLevel,
    levels: allLevelRules(),
    budgets: await budgetStatuses({ projectIds: [projectId] }),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      username: agent.username,
      agentLevel: isAutopilotLevel(agent.agentLevel) ? agent.agentLevel : null,
      raise: agent.raise,
      paused: agent.pausedAt != null,
      effective: effectiveLevel({
        projectLevel,
        agentLevel: agent.agentLevel,
        agentRaise: agent.raise,
      }),
    })),
  };
}

const EMPTY_USAGE: UsageTotals = { tokens: 0, cost: 0, unpricedTokens: 0, seconds: 0 };

export async function agentAutopilot(teamId: number, agentId: number) {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      level: aiAgent.autopilotLevel,
      raise: aiAgent.autopilotRaise,
      pausedAt: aiAgent.pausedAt,
      pauseReason: aiAgent.pauseReason,
    })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) throw new HttpError(404, 'Agent not found');
  const projects = await db
    .select({ id: project.id, key: project.key, name: project.name, level: project.autopilotLevel })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(and(eq(projectMember.userId, agent.userId), eq(project.teamId, teamId)))
    .orderBy(asc(project.key));
  const [budgets, projectBudgets, today, month] = await Promise.all([
    budgetStatuses({ agentIds: [agentId] }),
    budgetStatuses({ projectIds: projects.map((p) => p.id) }),
    usageSince('agent', [agentId], periodStart('day')),
    usageSince('agent', [agentId], periodStart('month')),
  ]);
  return {
    agentLevel: isAutopilotLevel(agent.level) ? agent.level : null,
    raise: agent.raise,
    paused: agent.pausedAt != null,
    pauseReason: agent.pauseReason,
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      projectLevel: p.level as AutopilotLevel,
      effective: effectiveLevel({
        projectLevel: p.level,
        agentLevel: agent.level,
        agentRaise: agent.raise,
      }),
      budgets: projectBudgets.filter((budget) => budget.projectId === p.id),
    })),
    budgets,
    usage: {
      today: today.get(agentId) ?? EMPTY_USAGE,
      month: month.get(agentId) ?? EMPTY_USAGE,
    },
    levels: allLevelRules(),
  };
}

export async function listDecisions(
  projectId: number,
  window: { limit: number; offset: number },
  outcome?: 'allow' | 'needs-approval' | 'deny',
) {
  const where = and(
    eq(helenaPolicyDecision.projectId, projectId),
    outcome ? eq(helenaPolicyDecision.outcome, outcome) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: helenaPolicyDecision.id,
        agentId: helenaPolicyDecision.agentId,
        agentName: user.name,
        runId: helenaPolicyDecision.runId,
        chatMessageId: helenaPolicyDecision.chatMessageId,
        adapter: helenaPolicyDecision.adapter,
        tool: helenaPolicyDecision.tool,
        category: helenaPolicyDecision.category,
        scope: helenaPolicyDecision.scope,
        outcome: helenaPolicyDecision.outcome,
        level: helenaPolicyDecision.level,
        levelSource: helenaPolicyDecision.levelSource,
        reason: helenaPolicyDecision.reason,
        summary: helenaPolicyDecision.summary,
        createdAt: helenaPolicyDecision.createdAt,
      })
      .from(helenaPolicyDecision)
      .leftJoin(aiAgent, eq(aiAgent.id, helenaPolicyDecision.agentId))
      .leftJoin(user, eq(user.id, aiAgent.userId))
      .where(where)
      .orderBy(desc(helenaPolicyDecision.id))
      .limit(window.limit)
      .offset(window.offset),
    db.select({ n: count() }).from(helenaPolicyDecision).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      category: row.category as ActionCategory,
      scope: row.scope as 'workspace' | 'external' | null,
      outcome: row.outcome as 'allow' | 'needs-approval' | 'deny',
      level: row.level as AutopilotLevel,
      levelSource: row.levelSource as 'project' | 'agent' | 'agent-raised' | 'default',
      reason: row.reason as EngineDecision['reason'],
      createdAt: iso(row.createdAt),
    })),
    total: Number(total?.n ?? 0),
  };
}

// The owner's answer on a budget card: raise the limit, let one more run start, or keep the
// work stopped. Closes the card; queues nothing, since the held runs are still in the queue.
export async function decideBudgetCard(
  approvalId: number,
  deciderUserId: string,
  input: { action: 'raise' | 'once' | 'keep'; limit?: number; note?: string },
): Promise<void> {
  const [card] = await db
    .select({
      id: approvalRequest.id,
      kind: approvalRequest.kind,
      status: approvalRequest.status,
      payload: approvalRequest.payload,
    })
    .from(approvalRequest)
    .where(eq(approvalRequest.id, approvalId));
  if (!card || card.kind !== 'budget') throw new HttpError(404, 'Budget card not found');
  if (card.status !== 'pending') throw new HttpError(409, 'This request has already been decided');
  const budgetId = (card.payload as { budgetId?: number } | null)?.budgetId;
  const budget = budgetId == null ? null : await getBudget(budgetId);
  const note = input.note?.trim() || null;
  const close = async (status: 'approved' | 'rejected', what: string) => {
    const rows = await db
      .update(approvalRequest)
      .set({
        status,
        decidedByUserId: deciderUserId,
        decidedAt: new Date(),
        decisionNote: note ?? what,
      })
      .where(and(eq(approvalRequest.id, approvalId), eq(approvalRequest.status, 'pending')))
      .returning({ id: approvalRequest.id });
    if (rows.length === 0) throw new HttpError(409, 'This request has already been decided');
  };
  if (input.action === 'keep') return close('rejected', 'kept');
  if (!budget) throw new HttpError(409, 'The budget no longer exists');
  if (budget.agentId != null) {
    const membership = await requireTeamMembership(budget.teamId, { id: deciderUserId });
    if (!runsTeam(membership.role))
      throw new HttpError(403, 'Only a team owner or manager can change an agent budget');
  }
  const target: BudgetTarget =
    budget.agentId != null ? { agentId: budget.agentId } : { projectId: budget.projectId! };
  if (input.action === 'once') {
    await close('approved', 'once');
    await continueOnce(budget.id);
    return;
  }
  const [status] = (
    await budgetStatuses(
      'agentId' in target ? { agentIds: [target.agentId] } : { projectIds: [target.projectId] },
    )
  ).filter((s) => s.id === budget.id);
  if (input.limit == null || input.limit <= (status?.used ?? 0)) {
    throw new HttpError(400, 'The new limit has to be above what is already used');
  }
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(helenaBudget)
      .set({ limitValue: input.limit!, reachedFor: null, updatedAt: new Date() })
      .where(eq(helenaBudget.id, budget.id))
      .returning({ id: helenaBudget.id });
    if (updated.length === 0) throw new HttpError(409, 'The budget no longer exists');
    const closed = await tx
      .update(approvalRequest)
      .set({
        status: 'approved',
        decidedByUserId: deciderUserId,
        decidedAt: new Date(),
        decisionNote: note ?? 'raised',
      })
      .where(and(eq(approvalRequest.id, approvalId), eq(approvalRequest.status, 'pending')))
      .returning({ id: approvalRequest.id });
    if (closed.length === 0) throw new HttpError(409, 'This request has already been decided');
  });
  await settleBudgets(target, deciderUserId);
}

// The project a runtime's question is about: the run's, the chat's, or the one it names
// among the agent's projects. Null for Home work.
async function askedProject(
  agent: RunnerAgent,
  input: { runId?: number; messageId?: number; projectKey?: string },
): Promise<{ projectId: number | null; runId: number | null; chatMessageId: number | null }> {
  if (input.runId != null) {
    const [run] = await db
      .select({ id: agentRun.id, projectId: agentRun.projectId })
      .from(agentRun)
      .where(and(eq(agentRun.id, input.runId), eq(agentRun.agentId, agent.id)));
    if (!run) throw new HttpError(404, 'Run not found');
    return { projectId: run.projectId, runId: run.id, chatMessageId: null };
  }
  if (input.messageId != null) {
    const [message] = await db
      .select({ id: agentChatMessage.id, projectId: agentChatThread.projectId })
      .from(agentChatMessage)
      .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
      .where(and(eq(agentChatMessage.id, input.messageId), eq(agentChatMessage.agentId, agent.id)));
    if (!message) throw new HttpError(404, 'Chat answer not found');
    return { projectId: message.projectId, runId: null, chatMessageId: message.id };
  }
  if (input.projectKey) {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.key, input.projectKey), eq(project.teamId, agent.teamId)));
    if (!row || !agent.projects.some((p) => p.key === input.projectKey)) {
      throw new HttpError(404, 'Project not found');
    }
    return { projectId: row.id, runId: null, chatMessageId: null };
  }
  return { projectId: null, runId: null, chatMessageId: null };
}

export interface RuntimeQuestion {
  runId?: number;
  messageId?: number;
  projectKey?: string;
  runtime: string;
  tool: string;
  command?: string;
  path?: string;
  mcp?: { server: string; annotations?: ToolAnnotations | null; action?: ActionCategory | null };
  dangerous?: boolean;
  workspace?: string;
  intent?: ActionCategory;
  summary?: string;
}

// A runtime asks before a tool call (Hermes' approval guard, the Claude Code hook, the
// browser gateway): the engine classifies the call and decides.
export async function decideForRuntime(
  agent: RunnerAgent,
  question: RuntimeQuestion,
): Promise<EngineDecision> {
  const where = await askedProject(agent, question);
  const { category, scope } = classifyToolCall({
    runtime: question.runtime,
    tool: question.tool,
    command: question.command,
    path: question.path,
    mcp: question.mcp,
    dangerous: question.dangerous,
    workspace: question.workspace,
    intent: question.intent,
  });
  const adapter = ['hermes', 'claude', 'codex', 'gateway'].includes(question.runtime)
    ? question.runtime
    : `runtime:${question.runtime.slice(0, 24)}`;
  return decide({
    adapter,
    agentId: agent.id,
    teamId: agent.teamId,
    projectId: where.projectId,
    runId: where.runId,
    chatMessageId: where.chatMessageId,
    category,
    scope,
    tool: question.mcp ? `${question.mcp.server}:${question.tool}` : question.tool,
    summary: question.summary ?? question.command ?? question.path ?? null,
    command: question.command ?? null,
  });
}

// The level a run works at, for its badge and its prompt.
export async function runLevel(agentId: number, projectId: number) {
  return resolveLevel(agentId, projectId);
}

export type { BudgetStatus };

// Whether a project's budgets hold its work now, for a chat about to be sent in it.
export async function assertProjectNotHeld(projectId: number | null): Promise<void> {
  if (projectId == null) return;
  const held = (await budgetStatuses({ projectIds: [projectId] })).find(
    (status) => status.reached && status.graceRuns === 0,
  );
  if (held) {
    throw new HttpError(
      409,
      "This project's budget is used up. Raise it or let the work continue once in Approvals.",
    );
  }
}
