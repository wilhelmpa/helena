import { db, agentRun, agentUsage, aiAgent } from '@repo/db';
import { and, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { costOf } from '@helena/policy';
import { price } from '#modules/model-prices/service';

// What agents spent, for the budgets: tokens, euros (estimated from the price table at read
// time, so a price change applies to what was spent before) and seconds of work. The one
// usage ledger is agent_usage (hub/hermes-in-helena): a row per run, chat answer and
// reflection. A finished run that has no ledger row yet (it ran before the ledger, or its
// runner does not report one) counts from agent_run instead, so the budgets never miss
// work while the ledger fills; once every run has its rows that part contributes nothing.

export type BudgetMetric = 'tokens' | 'cost' | 'time';
export type BudgetPeriod = 'day' | 'month';

// Days and months are UTC, as the token ceilings were.
export function periodStart(period: BudgetPeriod, now = new Date()): Date {
  return period === 'day'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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

// The usage of each of the given agents (or projects) since `since`.
export async function usageSince(
  by: 'agent' | 'project',
  ids: number[],
  since: Date,
): Promise<Map<number, UsageTotals>> {
  const totals = new Map<number, UsageTotals>();
  if (ids.length === 0) return totals;
  const ledgerKey = by === 'agent' ? agentUsage.agentId : agentUsage.projectId;
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
    .where(and(inArray(ledgerKey, ids), gte(agentUsage.occurredAt, since)))
    .groupBy(ledgerKey, agentUsage.model, agentUsage.provider);
  await addRows(totals, ledger);

  // Finished runs the ledger has no row for.
  const runKey = by === 'agent' ? agentRun.agentId : agentRun.projectId;
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
