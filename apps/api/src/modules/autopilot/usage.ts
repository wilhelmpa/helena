import {
  db,
  agentRun,
  agentUsage,
  aiAgent,
  issue,
  organizationAgentAssignment,
  organizationGoal,
  organizationProjectAssignment,
  project,
} from '@repo/db';
import { and, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { costOf } from '@helena/policy';
import { price } from '#modules/model-prices/service';
import { usageBy } from '#modules/agents/usage/service';

// What agents spent, for the budgets: tokens, euros (estimated from the price table at read
// time, so a price change applies to what was spent before) and seconds of work. The one
// usage ledger is agent_usage (hub/hermes-in-helena): a row per run, chat answer and
// reflection. A finished run that has no ledger row yet (it ran before the ledger, or its
// runner does not report one) counts from agent_run instead, so the budgets never miss
// work while the ledger fills; once every run has its rows that part contributes nothing.

export type BudgetMetric = 'tokens' | 'cost' | 'time';
export type BudgetPeriod = 'day' | 'week' | 'month';

// Days and months are UTC, as the token ceilings were.
export function periodStart(period: BudgetPeriod, now = new Date()): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'day') return day;
  if (period === 'week') {
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return day;
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface UsageTotals {
  // Input (cache included) and output tokens.
  tokens: number;
  // Euros, estimated; tokens of a model without a price count nothing here.
  cost: number;
  // Tokens of models the price table has no price for.
  unpricedTokens: number;
  seconds: number;
}

const ZERO: UsageTotals = { tokens: 0, cost: 0, unpricedTokens: 0, seconds: 0 };

export type UsageScope = { agentId: number } | { projectId: number };

interface ModelRow {
  key: number;
  model: string | null;
  provider: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  seconds: number;
}

async function addRows(totals: Map<number, UsageTotals>, rows: ModelRow[]): Promise<void> {
  for (const row of rows) {
    const current = totals.get(row.key) ?? { ...ZERO };
    const tokens = row.input + row.output;
    const found = await price(row.model, row.provider);
    const cost = found
      ? costOf(
          {
            inputTokens: row.input,
            outputTokens: row.output,
            cacheReadTokens: row.cacheRead,
            cacheWriteTokens: row.cacheWrite,
          },
          found,
        )
      : 0;
    totals.set(row.key, {
      tokens: current.tokens + tokens,
      cost: current.cost + cost,
      unpricedTokens: current.unpricedTokens + (found ? 0 : tokens),
      seconds: current.seconds + row.seconds,
    });
  }
}

// The usage of each requested scope since `since`.
export async function usageSince(
  by: 'issue' | 'agent' | 'project' | 'goal' | 'department',
  ids: number[],
  since: Date,
): Promise<Map<number, UsageTotals>> {
  const totals = new Map<number, UsageTotals>();
  if (ids.length === 0) return totals;
  if (by === 'issue') {
    const issues = await db
      .select({ id: issue.id, teamId: project.teamId })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(inArray(issue.id, ids));
    for (const teamId of new Set(issues.map((row) => row.teamId))) {
      const rows = await usageBy({ teamId, from: since, to: new Date(Date.now() + 86_400_000) }, [
        'issue',
      ]);
      for (const row of rows) {
        if (row.issueId == null || !ids.includes(row.issueId)) continue;
        const current = totals.get(row.issueId) ?? { ...ZERO };
        const tokens = row.inputTokens + row.outputTokens;
        totals.set(row.issueId, {
          tokens: current.tokens + tokens,
          cost: current.cost + (row.costEur ?? 0),
          unpricedTokens: current.unpricedTokens + (row.costEur === null ? tokens : 0),
          seconds: current.seconds + row.durationMs / 1000,
        });
      }
    }
    return totals;
  }
  if (by === 'goal') {
    const goals = await db
      .select({
        id: organizationGoal.id,
        teamId: organizationGoal.teamId,
        parentId: organizationGoal.parentGoalId,
      })
      .from(organizationGoal);
    const wanted = new Set(ids);
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    const teams = new Set(goals.filter((goal) => wanted.has(goal.id)).map((goal) => goal.teamId));
    for (const teamId of teams) {
      const rows = await usageBy({ teamId, from: since, to: new Date(Date.now() + 86_400_000) }, [
        'goal',
      ]);
      for (const row of rows) {
        let goalId = row.goalId;
        const visited = new Set<number>();
        while (goalId != null && !visited.has(goalId)) {
          visited.add(goalId);
          const goal = byId.get(goalId);
          if (!goal || goal.teamId !== teamId) break;
          if (wanted.has(goalId)) {
            const current = totals.get(goalId) ?? { ...ZERO };
            const tokens = row.inputTokens + row.outputTokens;
            totals.set(goalId, {
              tokens: current.tokens + tokens,
              cost: current.cost + (row.costEur ?? 0),
              unpricedTokens: current.unpricedTokens + (row.costEur === null ? tokens : 0),
              seconds: current.seconds + row.durationMs / 1000,
            });
          }
          goalId = goal.parentId;
        }
      }
    }
    return totals;
  }
  const ledgerKey = sql<number>`${
    by === 'agent'
      ? agentUsage.agentId
      : by === 'project'
        ? agentUsage.projectId
        : sql<number>`coalesce(${organizationProjectAssignment.departmentId}, ${organizationAgentAssignment.departmentId})`
  }`;
  const ledger = await db
    .select({
      key: sql<number>`${ledgerKey}`,
      model: agentUsage.model,
      provider: agentUsage.provider,
      input: sql<number>`coalesce(sum(${agentUsage.inputTokens}), 0)::float8`,
      output: sql<number>`coalesce(sum(${agentUsage.outputTokens}), 0)::float8`,
      cacheRead: sql<number>`coalesce(sum(${agentUsage.cacheReadTokens}), 0)::float8`,
      cacheWrite: sql<number>`coalesce(sum(${agentUsage.cacheWriteTokens}), 0)::float8`,
      seconds: sql<number>`coalesce(sum(${agentUsage.durationMs}), 0)::float8 / 1000`,
    })
    .from(agentUsage)
    .leftJoin(aiAgent, eq(aiAgent.id, agentUsage.agentId))
    .leftJoin(
      organizationProjectAssignment,
      eq(organizationProjectAssignment.projectId, agentUsage.projectId),
    )
    .leftJoin(
      organizationAgentAssignment,
      eq(organizationAgentAssignment.agentId, agentUsage.agentId),
    )
    .where(and(inArray(ledgerKey, ids), gte(agentUsage.occurredAt, since)))
    .groupBy(ledgerKey, agentUsage.model, agentUsage.provider);
  await addRows(totals, ledger);

  // Finished runs the ledger has no row for.
  const runKey = sql<number>`${
    by === 'agent'
      ? agentRun.agentId
      : by === 'project'
        ? agentRun.projectId
        : sql<number>`coalesce(${organizationProjectAssignment.departmentId}, ${organizationAgentAssignment.departmentId})`
  }`;
  const unledgered: SQL = sql`NOT EXISTS (SELECT 1 FROM agent_usage u WHERE u.run_id = ${agentRun.id})`;
  const runs = await db
    .select({
      key: sql<number>`${runKey}`,
      model: sql<string | null>`coalesce(${agentRun.model}, ${aiAgent.model})`,
      provider: sql<string | null>`NULL`,
      input: sql<number>`coalesce(sum(${agentRun.inputTokens}), 0)::float8`,
      output: sql<number>`coalesce(sum(${agentRun.outputTokens}), 0)::float8`,
      cacheRead: sql<number>`0::float8`,
      cacheWrite: sql<number>`0::float8`,
      seconds: sql<number>`coalesce(sum(extract(epoch from ${agentRun.finishedAt} - coalesce(${agentRun.claimedAt}, ${agentRun.startedAt}))), 0)::float8`,
    })
    .from(agentRun)
    .innerJoin(aiAgent, sql`${aiAgent.id} = ${agentRun.agentId}`)
    .leftJoin(
      organizationProjectAssignment,
      eq(organizationProjectAssignment.projectId, agentRun.projectId),
    )
    .leftJoin(
      organizationAgentAssignment,
      eq(organizationAgentAssignment.agentId, agentRun.agentId),
    )
    .where(
      and(
        inArray(runKey, ids),
        gte(agentRun.finishedAt, since),
        isNotNull(agentRun.finishedAt),
        unledgered,
      ),
    )
    .groupBy(runKey, sql`coalesce(${agentRun.model}, ${aiAgent.model})`);
  await addRows(totals, runs);
  return totals;
}

export async function usageOf(scope: UsageScope, since: Date): Promise<UsageTotals> {
  const [by, id] =
    'agentId' in scope
      ? (['agent', scope.agentId] as const)
      : (['project', scope.projectId] as const);
  return (await usageSince(by, [id], since)).get(id) ?? { ...ZERO };
}

export function metricValue(totals: UsageTotals, metric: BudgetMetric): number {
  return metric === 'tokens' ? totals.tokens : metric === 'cost' ? totals.cost : totals.seconds;
}
