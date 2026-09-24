import { db, aiAgent, approvalRequest, helenaBudget, project, projectMember, user } from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { createComment } from '#modules/issues/activity';
import {
  metricValue,
  periodStart,
  usageSince,
  type BudgetMetric,
  type BudgetPeriod,
  type UsageTotals,
} from './usage';

// Budgets of agents and projects (Helena's Autopilot): tokens, euros and seconds of work per
// UTC day or month. At 80 % the owner of the budget is told once per period, on the task
// the work was for. At 100 % the work stops cleanly: an agent budget pauses the agent, a
// project budget holds the project's runs and chats, and the owner gets a card in
// Freigaben to raise the budget or let the work continue once. Replaces the token ceilings
// of governance.ts, whose values the migration copied here.

export type BudgetRow = typeof helenaBudget.$inferSelect;

export const WARN_RATIO = 0.8;

export interface BudgetStatus {
  id: number;
  scope: 'agent' | 'project';
  agentId: number | null;
  projectId: number | null;
  metric: BudgetMetric;
  period: BudgetPeriod;
  limit: number;
  used: number;
  remaining: number;
  // used / limit.
  ratio: number;
  periodStart: string;
  warned: boolean;
  reached: boolean;
  // Runs that may still start past the limit in this period ("Einmalig fortsetzen").
  graceRuns: number;
  // For a cost budget: tokens of models the price table has no price for, which count
  // nothing here.
  unpricedTokens: number;
}

function sameStart(value: Date | null, start: Date): boolean {
  return value != null && value.getTime() === start.getTime();
}

function toStatus(row: BudgetRow, usage: UsageTotals | undefined): BudgetStatus {
  const metric = row.metric as BudgetMetric;
  const period = row.period as BudgetPeriod;
  const start = periodStart(period);
  const used = usage ? metricValue(usage, metric) : 0;
  const limit = row.limitValue;
  return {
    id: row.id,
    scope: row.agentId != null ? 'agent' : 'project',
    agentId: row.agentId,
    projectId: row.projectId,
    metric,
    period,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    ratio: limit > 0 ? used / limit : 0,
    periodStart: start.toISOString(),
    warned: sameStart(row.warnedFor, start),
    reached: used >= limit,
    graceRuns: sameStart(row.graceFor, start) ? row.graceRuns : 0,
    unpricedTokens: metric === 'cost' ? (usage?.unpricedTokens ?? 0) : 0,
  };
}

// The status of every budget of the given agents and projects.
export async function budgetStatuses(targets: {
  agentIds?: number[];
  projectIds?: number[];
}): Promise<BudgetStatus[]> {
  const agentIds = targets.agentIds ?? [];
  const projectIds = targets.projectIds ?? [];
  if (agentIds.length === 0 && projectIds.length === 0) return [];
  const rows = await db
    .select()
    .from(helenaBudget)
    .where(
      or(
        agentIds.length > 0 ? inArray(helenaBudget.agentId, agentIds) : undefined,
        projectIds.length > 0 ? inArray(helenaBudget.projectId, projectIds) : undefined,
      ),
    )
    .orderBy(helenaBudget.id);
  if (rows.length === 0) return [];
  const monthStart = periodStart('month');
  const dayStart = periodStart('day');
  const wantAgents = [...new Set(rows.flatMap((r) => (r.agentId != null ? [r.agentId] : [])))];
  const wantProjects = [
    ...new Set(rows.flatMap((r) => (r.projectId != null ? [r.projectId] : []))),
  ];
  const needsDay = rows.some((r) => r.period === 'day');
  const [agentMonth, agentDay, projectMonth, projectDay] = await Promise.all([
    usageSince('agent', wantAgents, monthStart),
    needsDay ? usageSince('agent', wantAgents, dayStart) : new Map<number, UsageTotals>(),
    usageSince('project', wantProjects, monthStart),
    needsDay ? usageSince('project', wantProjects, dayStart) : new Map<number, UsageTotals>(),
  ]);
  return rows.map((row) => {
    const byAgent = row.agentId != null;
    const usage =
      row.period === 'day'
        ? (byAgent ? agentDay : projectDay).get((byAgent ? row.agentId : row.projectId)!)
        : (byAgent ? agentMonth : projectMonth).get((byAgent ? row.agentId : row.projectId)!);
    return toStatus(row, usage);
  });
}

const METRIC_TEXT: Record<BudgetMetric, string> = {
  tokens: 'token',
  cost: 'cost',
  time: 'time',
};

function amount(metric: BudgetMetric, value: number): string {
  if (metric === 'cost') return `€${value.toFixed(2)}`;
  if (metric === 'time') return `${Math.round(value / 60).toLocaleString('en-US')} min`;
  return `${Math.round(value).toLocaleString('en-US')} tokens`;
}

// The reason an exhausted budget gives, in the words the pause reason and the comments use.
// Starts with "Budget reached" so a pause it caused can be told apart.
export function budgetReason(status: BudgetStatus, projectKey?: string | null): string {
  const periodText = status.period === 'day' ? 'Daily' : 'Monthly';
  const of = status.scope === 'project' && projectKey ? ` of project ${projectKey}` : '';
  const when = status.period === 'day' ? 'today (UTC)' : 'this month (UTC)';
  return (
    `${BUDGET_REASON_PREFIX}: ${periodText} ${METRIC_TEXT[status.metric]} budget${of}: ` +
    `${amount(status.metric, status.used)} of ${amount(status.metric, status.limit)} used ${when}.`
  );
}

export const BUDGET_REASON_PREFIX = 'Budget reached';

export function isBudgetPause(reason: string | null | undefined): boolean {
  return reason?.startsWith(BUDGET_REASON_PREFIX) === true;
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

interface AgentFacts {
  id: number;
  userId: string;
  ownerUserId: string | null;
  pausedAt: Date | null;
  pauseReason: string | null;
}

async function agentFacts(agentId: number): Promise<AgentFacts | null> {
  const [row] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      ownerUserId: aiAgent.ownerUserId,
      pausedAt: aiAgent.pausedAt,
      pauseReason: aiAgent.pauseReason,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return row ?? null;
}

async function projectKeyOf(projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  return row?.key ?? null;
}

// Pauses the agent unless it already is. True when this call paused it.
export async function pauseForBudget(agentId: number, reason: string): Promise<boolean> {
  const rows = await db
    .update(aiAgent)
    .set({ pausedAt: new Date(), pauseReason: reason })
    .where(and(eq(aiAgent.id, agentId), isNull(aiAgent.pausedAt)))
    .returning({ id: aiAgent.id });
  return rows.length > 0;
}

// Marks a period's warning (or reached limit) as sent; true for the one call that did.
async function claimOnce(
  id: number,
  column: 'warnedFor' | 'reachedFor',
  start: Date,
): Promise<boolean> {
  const target = column === 'warnedFor' ? helenaBudget.warnedFor : helenaBudget.reachedFor;
  const rows = await db
    .update(helenaBudget)
    .set({ [column]: start, updatedAt: new Date() })
    .where(
      and(
        eq(helenaBudget.id, id),
        or(isNull(target), sql`${target} <> ${start.toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: helenaBudget.id });
  return rows.length > 0;
}

// Files the owner's card for a budget that was reached: an approval request of kind
// 'budget' in the project the work was in. One pending card per budget.
async function fileBudgetCard(
  status: BudgetStatus,
  agentId: number,
  projectId: number,
  issueId: number | null,
  reason: string,
): Promise<void> {
  const [pending] = await db
    .select({ id: approvalRequest.id })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.kind, 'budget'),
        eq(approvalRequest.status, 'pending'),
        sql`(${approvalRequest.payload}->>'budgetId')::int = ${status.id}`,
      ),
    );
  if (pending) return;
  await db.insert(approvalRequest).values({
    projectId,
    agentId,
    issueId,
    kind: 'budget',
    category: null,
    action: reason,
    details: '',
    policyReason: 'budget-exhausted',
    payload: {
      budgetId: status.id,
      scope: status.scope,
      metric: status.metric,
      period: status.period,
      limit: status.limit,
      used: status.used,
      periodStart: status.periodStart,
      agentId: status.agentId,
      projectId: status.projectId,
    },
  });
}

export interface EnforceOptions {
  // A claim starts a run: it may use one of the runs "continue once" allowed.
  consumeGrace?: boolean;
}

// The budgets of the agent and the project that hold its work back now: reached, and not
// lifted for one more run. Warns at 80 % and files the card at 100 %, each once per period.
export async function enforceBudgets(
  agentId: number,
  projectId: number,
  issueId: number | null,
  options: EnforceOptions = {},
): Promise<string | null> {
  const statuses = await budgetStatuses({ agentIds: [agentId], projectIds: [projectId] });
  if (statuses.length === 0) return null;
  const agent = await agentFacts(agentId);
  if (!agent) return null;
  const key = await projectKeyOf(projectId);

  for (const status of statuses) {
    if (status.reached || status.ratio < WARN_RATIO || status.warned) continue;
    if (!(await claimOnce(status.id, 'warnedFor', new Date(status.periodStart)))) continue;
    if (issueId == null) continue;
    const handles = await noticeRecipients(
      projectId,
      status.scope === 'agent' ? agent.ownerUserId : null,
    );
    const percent = Math.floor(status.ratio * 100);
    await createComment({
      issueId,
      actorUserId: agent.userId,
      body: [
        ...handles,
        `Heads-up: ${percent} % of my ${status.period === 'day' ? 'daily' : 'monthly'} ` +
          `${METRIC_TEXT[status.metric]} budget${status.scope === 'project' && key ? ` of project ${key}` : ''} ` +
          `is used (${amount(status.metric, status.used)} of ${amount(status.metric, status.limit)}). ` +
          'I stop taking new work when it is used up.',
      ].join(' '),
    });
  }

  const reached = statuses.filter((status) => status.reached);
  if (reached.length === 0) return null;
  const blocking = reached.filter((status) => status.graceRuns === 0);
  if (blocking.length === 0) {
    if (options.consumeGrace) {
      for (const status of reached) {
        await db
          .update(helenaBudget)
          .set({ graceRuns: sql`greatest(${helenaBudget.graceRuns} - 1, 0)` })
          .where(eq(helenaBudget.id, status.id));
      }
    }
    return null;
  }

  const first = blocking.find((status) => status.scope === 'agent') ?? blocking[0]!;
  const reason = budgetReason(first, key);
  const paused = first.scope === 'agent' ? await pauseForBudget(agentId, reason) : false;
  const filed = await claimOnce(first.id, 'reachedFor', new Date(first.periodStart));
  if (filed) await fileBudgetCard(first, agentId, projectId, issueId, reason);
  if ((paused || filed) && issueId != null) {
    const handles = await noticeRecipients(
      projectId,
      first.scope === 'agent' ? agent.ownerUserId : null,
    );
    await createComment({
      issueId,
      actorUserId: agent.userId,
      body: [
        ...handles,
        first.scope === 'agent'
          ? `I am paused and take no new work. ${reason}`
          : `The work of project ${key ?? ''} is on hold. ${reason}`,
        'Raise the budget or let me continue once from the card in Approvals.',
      ].join(' '),
    });
  }
  return reason;
}

// The projects whose budgets are used up without a run left to continue on, among the
// given ones. A claim skips their runs, so the agent still works in its other projects.
export async function heldProjects(projectIds: number[]): Promise<number[]> {
  if (projectIds.length === 0) return [];
  const statuses = await budgetStatuses({ projectIds });
  return [
    ...new Set(
      statuses
        .filter((status) => status.reached && status.graceRuns === 0)
        .map((status) => status.projectId!),
    ),
  ];
}

// Whether a budget of the agent or of the project is used up for good right now. The
// policy engine denies every action but reading and reporting then.
export async function budgetExhausted(
  agentId: number | null,
  projectId: number | null,
): Promise<BudgetStatus | null> {
  const statuses = await budgetStatuses({
    agentIds: agentId == null ? [] : [agentId],
    projectIds: projectId == null ? [] : [projectId],
  });
  return statuses.find((status) => status.reached && status.graceRuns === 0) ?? null;
}

export interface BudgetInput {
  metric: BudgetMetric;
  period: BudgetPeriod;
  // Null removes the budget.
  limit: number | null;
}

export type BudgetTarget = { agentId: number } | { projectId: number };

// Sets the budgets named; the ones not named stay as they are. An agent whose budget
// pause no longer holds takes work again, and a pending card of a budget that is no longer
// reached is closed as raised.
export async function setBudgets(
  teamId: number,
  target: BudgetTarget,
  entries: BudgetInput[],
  deciderUserId: string | null,
): Promise<void> {
  for (const entry of entries) {
    const where = and(
      'agentId' in target
        ? eq(helenaBudget.agentId, target.agentId)
        : eq(helenaBudget.projectId, target.projectId),
      eq(helenaBudget.metric, entry.metric),
      eq(helenaBudget.period, entry.period),
    );
    if (entry.limit == null) {
      await db.delete(helenaBudget).where(where);
      continue;
    }
    const updated = await db
      .update(helenaBudget)
      .set({ limitValue: entry.limit, updatedAt: new Date() })
      .where(where)
      .returning({ id: helenaBudget.id });
    if (updated.length === 0) {
      await db.insert(helenaBudget).values({
        teamId,
        ...('agentId' in target ? { agentId: target.agentId } : { projectId: target.projectId }),
        metric: entry.metric,
        period: entry.period,
        limitValue: entry.limit,
      });
    }
  }
  await settleBudgets(target, deciderUserId);
}

// After a budget changed: closes the cards of budgets no longer reached and lets an agent
// that a budget paused work again once none of its budgets holds it.
export async function settleBudgets(
  target: BudgetTarget,
  deciderUserId: string | null,
): Promise<void> {
  const statuses = await budgetStatuses(
    'agentId' in target ? { agentIds: [target.agentId] } : { projectIds: [target.projectId] },
  );
  const open = await db
    .select({ id: approvalRequest.id, payload: approvalRequest.payload })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.kind, 'budget'), eq(approvalRequest.status, 'pending')));
  for (const card of open) {
    const budgetId = (card.payload as { budgetId?: number } | null)?.budgetId;
    const status = statuses.find((s) => s.id === budgetId);
    const belongs =
      'agentId' in target
        ? (card.payload as { agentId?: number | null })?.agentId === target.agentId
        : (card.payload as { projectId?: number | null })?.projectId === target.projectId;
    if (!belongs) continue;
    if (status && status.reached && status.graceRuns === 0) continue;
    await db
      .update(approvalRequest)
      .set({
        status: 'approved',
        decidedByUserId: deciderUserId,
        decidedAt: new Date(),
        decisionNote: 'raised',
      })
      .where(and(eq(approvalRequest.id, card.id), eq(approvalRequest.status, 'pending')));
    if (budgetId != null) {
      await db.update(helenaBudget).set({ reachedFor: null }).where(eq(helenaBudget.id, budgetId));
    }
  }
  if (!('agentId' in target)) return;
  const agent = await agentFacts(target.agentId);
  if (!agent?.pausedAt || !isBudgetPause(agent.pauseReason)) return;
  if (statuses.some((status) => status.reached && status.graceRuns === 0)) return;
  await db
    .update(aiAgent)
    .set({ pausedAt: null, pauseReason: null })
    .where(eq(aiAgent.id, target.agentId));
}

// "Einmalig fortsetzen": one more run may start past the limit in this period. An agent the
// budget paused takes work again for it.
export async function continueOnce(budgetId: number): Promise<BudgetRow> {
  const [row] = await db.select().from(helenaBudget).where(eq(helenaBudget.id, budgetId));
  if (!row) throw new HttpError(404, 'Budget not found');
  const start = periodStart(row.period as BudgetPeriod);
  const [updated] = await db
    .update(helenaBudget)
    .set({
      graceFor: start,
      graceRuns: sameStart(row.graceFor, start) ? sql`${helenaBudget.graceRuns} + 1` : 1,
      // Reached again after that run, the budget files a new card.
      reachedFor: null,
      updatedAt: new Date(),
    })
    .where(eq(helenaBudget.id, budgetId))
    .returning();
  if (row.agentId != null) {
    const agent = await agentFacts(row.agentId);
    if (agent?.pausedAt && isBudgetPause(agent.pauseReason)) {
      await db
        .update(aiAgent)
        .set({ pausedAt: null, pauseReason: null })
        .where(eq(aiAgent.id, row.agentId));
    }
  }
  return updated!;
}

export async function getBudget(budgetId: number): Promise<BudgetRow | null> {
  const [row] = await db.select().from(helenaBudget).where(eq(helenaBudget.id, budgetId));
  return row ?? null;
}
