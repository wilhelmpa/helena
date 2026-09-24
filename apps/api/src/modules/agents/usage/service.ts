import { db, agentUsage, aiAgent, project, user } from '@repo/db';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';

// The token ledger (agent_usage): one row per run, chat answer or reflection, written when
// the runner reports what it spent. Usage per agent, model, project and day is summed from
// here; cost is priced when read, so a changed or corrected price applies to the past too.

// What a runner reports (packages/runner/src/spend.ts), in the GenAI shape: input includes
// the cached reads and writes, output includes reasoning.
export interface Spend {
  runtime?: string | null;
  model?: string | null;
  provider?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  durationMs?: number | null;
}

const count = (value: number | undefined) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? Math.round(value!) : 0;

export async function recordUsage(entry: {
  agentId: number;
  projectId: number | null;
  runId?: number | null;
  chatMessageId?: number | null;
  kind: 'run' | 'chat' | 'reflection';
  sessionId?: string | null;
  spend: Spend | null | undefined;
}): Promise<void> {
  const spend = entry.spend;
  if (!spend) return;
  const row = {
    inputTokens: count(spend.inputTokens),
    outputTokens: count(spend.outputTokens),
    cacheReadTokens: count(spend.cacheReadTokens),
    cacheWriteTokens: count(spend.cacheWriteTokens),
    reasoningTokens: count(spend.reasoningTokens),
  };
  if (row.inputTokens + row.outputTokens === 0) return;
  await db.insert(agentUsage).values({
    agentId: entry.agentId,
    projectId: entry.projectId,
    runId: entry.runId ?? null,
    chatMessageId: entry.chatMessageId ?? null,
    kind: entry.kind,
    runtime: spend.runtime?.slice(0, 40) ?? null,
    model: spend.model?.slice(0, 200) ?? null,
    provider: spend.provider?.slice(0, 100) ?? null,
    sessionId: entry.sessionId?.slice(0, 200) ?? null,
    ...row,
    durationMs:
      spend.durationMs != null && Number.isFinite(spend.durationMs)
        ? Math.max(0, Math.min(Math.round(spend.durationMs), 2_000_000_000))
        : null,
  });
}

// ---------------------------------------------------------------- prices

// The model price table is owned by the autopilot package (#modules/model-prices/service:
// price(model, provider) and costOf(usage, price), in euro, seeded from models.dev). It is
// loaded by name so this module works before that one is merged; without it costs are null.
interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  currency: string;
}
interface PriceModule {
  price(model: string, provider?: string | null): Promise<ModelPrice | null>;
}

const PRICE_MODULE = '#modules/model-prices/service';
let prices: Promise<PriceModule | null> | null = null;

function priceModule(): Promise<PriceModule | null> {
  prices ??= import(/* @vite-ignore */ PRICE_MODULE as string).then(
    (module: Partial<PriceModule>) =>
      typeof module.price === 'function' ? (module as PriceModule) : null,
    () => null,
  );
  return prices;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number;
  entries: number;
}

// Euro for each row's tokens by the price of its model, null where the model has no price.
export async function priceRows<
  T extends Omit<UsageTotals, 'durationMs' | 'entries'> & {
    model: string | null;
    provider: string | null;
  },
>(rows: T[]): Promise<(T & { costEur: number | null })[]> {
  const module = await priceModule();
  return Promise.all(
    rows.map(async (row) => {
      const price =
        module && row.model ? await module.price(row.model, row.provider).catch(() => null) : null;
      return { ...row, costEur: costOf({ ...row, durationMs: 0, entries: 0 }, price) };
    }),
  );
}

// Euro for the tokens of one model, or null when the model has no price. Cached input is
// billed at its own rate where the price names one.
export function costOf(totals: UsageTotals, price: ModelPrice | null): number | null {
  if (!price) return null;
  const cacheRead = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWrite = price.cacheWritePerMTok ?? price.inputPerMTok;
  const plainInput = Math.max(
    0,
    totals.inputTokens - totals.cacheReadTokens - totals.cacheWriteTokens,
  );
  return (
    (plainInput * price.inputPerMTok +
      totals.cacheReadTokens * cacheRead +
      totals.cacheWriteTokens * cacheWrite +
      totals.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}

// ---------------------------------------------------------------- reading

export type UsageDimension = 'agent' | 'model' | 'project' | 'day' | 'kind';

export interface UsageFilter {
  teamId: number;
  from: Date;
  to: Date;
  agentId?: number;
  projectId?: number;
  // Bounds the rows to these projects (a reader who does not run the team), with the
  // project-less rows of the agents the reader sees.
  projectIds?: number[];
}

export interface UsageRow extends UsageTotals {
  agentId: number | null;
  agentName: string | null;
  model: string | null;
  provider: string | null;
  projectId: number | null;
  projectKey: string | null;
  day: string | null;
  kind: string | null;
  costEur: number | null;
}

function whereOf(filter: UsageFilter): SQL {
  return and(
    eq(aiAgent.teamId, filter.teamId),
    gte(agentUsage.occurredAt, filter.from),
    lt(agentUsage.occurredAt, filter.to),
    filter.agentId === undefined ? undefined : eq(agentUsage.agentId, filter.agentId),
    filter.projectId === undefined ? undefined : eq(agentUsage.projectId, filter.projectId),
    filter.projectIds === undefined
      ? undefined
      : filter.projectIds.length === 0
        ? sql`false`
        : inArray(agentUsage.projectId, filter.projectIds),
  )!;
}

const DAY = sql<string>`to_char(date_trunc('day', ${agentUsage.occurredAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

// The ledger summed by the given dimensions, each group priced by its model. The model is
// always part of the grouping underneath, because a price belongs to a model; groups that
// do not ask for it are merged after pricing.
export async function usageBy(
  filter: UsageFilter,
  dimensions: UsageDimension[],
): Promise<UsageRow[]> {
  const by = new Set(dimensions);
  const rows = await db
    .select({
      agentId: by.has('agent') ? agentUsage.agentId : sql<null>`null::int`,
      agentName: by.has('agent') ? user.name : sql<null>`null::text`,
      projectId: by.has('project') ? agentUsage.projectId : sql<null>`null::int`,
      projectKey: by.has('project') ? project.key : sql<null>`null::text`,
      day: by.has('day') ? DAY : sql<null>`null::text`,
      kind: by.has('kind') ? agentUsage.kind : sql<null>`null::text`,
      model: agentUsage.model,
      provider: agentUsage.provider,
      inputTokens: sql<number>`sum(${agentUsage.inputTokens})::float8`,
      outputTokens: sql<number>`sum(${agentUsage.outputTokens})::float8`,
      cacheReadTokens: sql<number>`sum(${agentUsage.cacheReadTokens})::float8`,
      cacheWriteTokens: sql<number>`sum(${agentUsage.cacheWriteTokens})::float8`,
      reasoningTokens: sql<number>`sum(${agentUsage.reasoningTokens})::float8`,
      durationMs: sql<number>`coalesce(sum(${agentUsage.durationMs}), 0)::float8`,
      entries: sql<number>`count(*)::int`,
    })
    .from(agentUsage)
    .innerJoin(aiAgent, eq(aiAgent.id, agentUsage.agentId))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, agentUsage.projectId))
    .where(whereOf(filter))
    .groupBy(
      ...(by.has('agent') ? [agentUsage.agentId, user.name] : []),
      ...(by.has('project') ? [agentUsage.projectId, project.key] : []),
      ...(by.has('day') ? [DAY] : []),
      ...(by.has('kind') ? [agentUsage.kind] : []),
      agentUsage.model,
      agentUsage.provider,
    )
    .orderBy(desc(sql`sum(${agentUsage.inputTokens} + ${agentUsage.outputTokens})`));
  const module = await priceModule();
  const priced = await Promise.all(
    rows.map(async (row) => {
      const price =
        module && row.model ? await module.price(row.model, row.provider).catch(() => null) : null;
      return { ...row, costEur: costOf(row, price) };
    }),
  );
  if (by.has('model')) return priced;
  // Merge the per-model groups the caller did not ask for.
  const merged = new Map<string, UsageRow>();
  for (const row of priced) {
    const key = JSON.stringify([row.agentId, row.projectId, row.day, row.kind]);
    const into = merged.get(key);
    if (!into) {
      merged.set(key, { ...row, model: null, provider: null });
      continue;
    }
    for (const field of [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
      'durationMs',
      'entries',
    ] as const) {
      into[field] += row[field];
    }
    into.costEur =
      into.costEur === null || row.costEur === null
        ? (into.costEur ?? row.costEur)
        : into.costEur + row.costEur;
  }
  return [...merged.values()];
}

// Whether any row of the filter had no price: the total cost is then a lower bound.
export function unpriced(rows: UsageRow[]): boolean {
  return rows.some((row) => row.costEur === null && row.inputTokens + row.outputTokens > 0);
}
