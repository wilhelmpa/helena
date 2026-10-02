import {
  db,
  agentRun,
  agentUsage,
  aiAgent,
  helenaGoalTask,
  helenaProjectGoalLink,
  issue,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  user,
} from '@repo/db';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

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

export async function recordUsage(
  entry: {
    agentId: number;
    projectId: number | null;
    runId?: number | null;
    chatMessageId?: number | null;
    kind: 'run' | 'chat' | 'reflection' | 'tool';
    sessionId?: string | null;
    spend: Spend | null | undefined;
  },
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<void> {
  const spend = entry.spend;
  if (!spend) return;
  const row = {
    inputTokens: count(spend.inputTokens),
    outputTokens: count(spend.outputTokens),
    cacheReadTokens: count(spend.cacheReadTokens),
    cacheWriteTokens: count(spend.cacheWriteTokens),
    reasoningTokens: count(spend.reasoningTokens),
  };
  if (
    row.inputTokens + row.outputTokens === 0 &&
    !(spend.durationMs && spend.durationMs > 0) &&
    !(entry.kind === 'run' && entry.runId)
  )
    return;
  const values = {
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
  };
  if (entry.kind === 'run' && entry.runId) {
    const [provisional] = await executor
      .delete(agentUsage)
      .where(
        and(
          eq(agentUsage.runId, entry.runId),
          eq(agentUsage.kind, 'run'),
          eq(agentUsage.provisional, true),
        ),
      )
      .returning({
        durationMs: agentUsage.durationMs,
        model: agentUsage.model,
        provider: agentUsage.provider,
        sessionId: agentUsage.sessionId,
      });
    values.durationMs ??= provisional?.durationMs ?? null;
    values.model ??= provisional?.model ?? null;
    values.provider ??= provisional?.provider ?? null;
    values.sessionId ??= provisional?.sessionId ?? null;
  }
  await executor.insert(agentUsage).values(values);
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
  if (totals.inputTokens + totals.outputTokens === 0) return 0;
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

export type UsageDimension =
  'issue' | 'agent' | 'model' | 'project' | 'goal' | 'department' | 'day' | 'kind';

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
  unledgeredRuns: number;
  issueId: number | null;
  issueTitle: string | null;
  agentId: number | null;
  agentName: string | null;
  model: string | null;
  provider: string | null;
  projectId: number | null;
  projectKey: string | null;
  goalId: number | null;
  goalTitle: string | null;
  departmentId: number | null;
  departmentName: string | null;
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
const RUN_DAY = sql<string>`to_char(date_trunc('day', ${agentRun.finishedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
const RUN_MODEL = sql<string>`coalesce(${agentRun.model}, ${aiAgent.model})`;
const parentIssue = alias(issue, 'usage_parent_issue');
const parentGoal = alias(helenaGoalTask, 'usage_parent_goal');
const initiativeGoal = alias(helenaProjectGoalLink, 'usage_initiative_goal');
const parentInitiativeGoal = alias(helenaProjectGoalLink, 'usage_parent_initiative_goal');
function goalIdOf(projectId: typeof agentUsage.projectId | typeof agentRun.projectId) {
  return sql<number>`coalesce(
    ${helenaGoalTask.goalId}, ${parentGoal.goalId},
    ${initiativeGoal.goalId}, ${parentInitiativeGoal.goalId},
    CASE WHEN ${issue.id} IS NOT NULL THEN (
      WITH RECURSIVE department_path(id, depth) AS (
        SELECT ${organizationProjectAssignment.departmentId}::int, 0
        UNION ALL
        SELECT d.parent_id, dp.depth + 1
        FROM organization_department d JOIN department_path dp ON d.id = dp.id
        WHERE d.parent_id IS NOT NULL AND dp.depth < 16
      )
      SELECT g.id FROM organization_goal g
      LEFT JOIN department_path dp ON dp.id = g.department_id
      WHERE g.team_id = ${aiAgent.teamId} AND g.status IN ('active', 'planned')
        AND (g.project_id = ${projectId}
          OR (g.project_id IS NULL AND (dp.id IS NOT NULL OR g.department_id IS NULL)))
      ORDER BY CASE WHEN g.project_id = ${projectId} THEN 0
        WHEN dp.id IS NOT NULL THEN dp.depth + 1 ELSE 100 END,
        CASE WHEN g.status = 'active' THEN 0 ELSE 1 END, g.id
      LIMIT 1
    ) END
  )`;
}
const LEDGER_GOAL_ID = goalIdOf(agentUsage.projectId);
const RUN_GOAL_ID = goalIdOf(agentRun.projectId);
const DEPARTMENT_ID = sql<number>`coalesce(${organizationProjectAssignment.departmentId}, ${organizationAgentAssignment.departmentId})`;

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
      issueId: by.has('issue') ? issue.id : sql<null>`null::int`,
      issueTitle: by.has('issue') ? issue.title : sql<null>`null::text`,
      agentId: by.has('agent') ? agentUsage.agentId : sql<null>`null::int`,
      agentName: by.has('agent') ? user.name : sql<null>`null::text`,
      projectId: by.has('project') ? agentUsage.projectId : sql<null>`null::int`,
      projectKey: by.has('project') ? project.key : sql<null>`null::text`,
      goalId: by.has('goal') ? organizationGoal.id : sql<null>`null::int`,
      goalTitle: by.has('goal') ? organizationGoal.title : sql<null>`null::text`,
      departmentId: by.has('department') ? organizationDepartment.id : sql<null>`null::int`,
      departmentName: by.has('department') ? organizationDepartment.name : sql<null>`null::text`,
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
      unledgeredRuns: sql<number>`0::int`,
    })
    .from(agentUsage)
    .innerJoin(aiAgent, eq(aiAgent.id, agentUsage.agentId))
    .leftJoin(agentRun, eq(agentRun.id, agentUsage.runId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .leftJoin(parentIssue, eq(parentIssue.id, issue.parentId))
    .leftJoin(helenaGoalTask, eq(helenaGoalTask.issueId, issue.id))
    .leftJoin(parentGoal, eq(parentGoal.issueId, parentIssue.id))
    .leftJoin(initiativeGoal, eq(initiativeGoal.initiativeId, issue.initiativeId))
    .leftJoin(parentInitiativeGoal, eq(parentInitiativeGoal.initiativeId, parentIssue.initiativeId))
    .leftJoin(
      organizationProjectAssignment,
      eq(organizationProjectAssignment.projectId, agentUsage.projectId),
    )
    .leftJoin(
      organizationAgentAssignment,
      eq(organizationAgentAssignment.agentId, agentUsage.agentId),
    )
    .leftJoin(organizationGoal, eq(organizationGoal.id, LEDGER_GOAL_ID))
    .leftJoin(organizationDepartment, eq(organizationDepartment.id, DEPARTMENT_ID))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, agentUsage.projectId))
    .where(whereOf(filter))
    .groupBy(
      ...(by.has('issue') ? [issue.id, issue.title] : []),
      ...(by.has('agent') ? [agentUsage.agentId, user.name] : []),
      ...(by.has('project') ? [agentUsage.projectId, project.key] : []),
      ...(by.has('goal') ? [organizationGoal.id, organizationGoal.title] : []),
      ...(by.has('department') ? [organizationDepartment.id, organizationDepartment.name] : []),
      ...(by.has('day') ? [DAY] : []),
      ...(by.has('kind') ? [agentUsage.kind] : []),
      agentUsage.model,
      agentUsage.provider,
    )
    .orderBy(desc(sql`sum(${agentUsage.inputTokens} + ${agentUsage.outputTokens})`));
  // Old or non-reporting runners still contribute their run totals. A run with any
  // ledger row is excluded, so the two sources never charge the same run twice.
  const unledgered = await db
    .select({
      issueId: by.has('issue') ? issue.id : sql<null>`null::int`,
      issueTitle: by.has('issue') ? issue.title : sql<null>`null::text`,
      agentId: by.has('agent') ? agentRun.agentId : sql<null>`null::int`,
      agentName: by.has('agent') ? user.name : sql<null>`null::text`,
      projectId: by.has('project') ? agentRun.projectId : sql<null>`null::int`,
      projectKey: by.has('project') ? project.key : sql<null>`null::text`,
      goalId: by.has('goal') ? organizationGoal.id : sql<null>`null::int`,
      goalTitle: by.has('goal') ? organizationGoal.title : sql<null>`null::text`,
      departmentId: by.has('department') ? organizationDepartment.id : sql<null>`null::int`,
      departmentName: by.has('department') ? organizationDepartment.name : sql<null>`null::text`,
      day: by.has('day') ? RUN_DAY : sql<null>`null::text`,
      kind: by.has('kind') ? sql<string>`'run'` : sql<null>`null::text`,
      model: RUN_MODEL,
      provider: sql<null>`null::text`,
      inputTokens: sql<number>`coalesce(sum(${agentRun.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${agentRun.outputTokens}), 0)::float8`,
      cacheReadTokens: sql<number>`0::float8`,
      cacheWriteTokens: sql<number>`0::float8`,
      reasoningTokens: sql<number>`0::float8`,
      durationMs: sql<number>`coalesce(sum(extract(epoch from ${agentRun.finishedAt} - coalesce(${agentRun.claimedAt}, ${agentRun.startedAt})) * 1000), 0)::float8`,
      entries: sql<number>`count(*)::int`,
      unledgeredRuns: sql<number>`count(*)::int`,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .leftJoin(parentIssue, eq(parentIssue.id, issue.parentId))
    .leftJoin(helenaGoalTask, eq(helenaGoalTask.issueId, issue.id))
    .leftJoin(parentGoal, eq(parentGoal.issueId, parentIssue.id))
    .leftJoin(initiativeGoal, eq(initiativeGoal.initiativeId, issue.initiativeId))
    .leftJoin(parentInitiativeGoal, eq(parentInitiativeGoal.initiativeId, parentIssue.initiativeId))
    .leftJoin(
      organizationProjectAssignment,
      eq(organizationProjectAssignment.projectId, agentRun.projectId),
    )
    .leftJoin(
      organizationAgentAssignment,
      eq(organizationAgentAssignment.agentId, agentRun.agentId),
    )
    .leftJoin(organizationGoal, eq(organizationGoal.id, RUN_GOAL_ID))
    .leftJoin(organizationDepartment, eq(organizationDepartment.id, DEPARTMENT_ID))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, agentRun.projectId))
    .where(
      and(
        eq(aiAgent.teamId, filter.teamId),
        gte(agentRun.finishedAt, filter.from),
        lt(agentRun.finishedAt, filter.to),
        filter.agentId === undefined ? undefined : eq(agentRun.agentId, filter.agentId),
        filter.projectId === undefined ? undefined : eq(agentRun.projectId, filter.projectId),
        filter.projectIds === undefined
          ? undefined
          : filter.projectIds.length === 0
            ? sql`false`
            : inArray(agentRun.projectId, filter.projectIds),
        sql`NOT EXISTS (SELECT 1 FROM agent_usage u WHERE u.run_id = ${agentRun.id})`,
      ),
    )
    .groupBy(
      ...(by.has('issue') ? [issue.id, issue.title] : []),
      ...(by.has('agent') ? [agentRun.agentId, user.name] : []),
      ...(by.has('project') ? [agentRun.projectId, project.key] : []),
      ...(by.has('goal') ? [organizationGoal.id, organizationGoal.title] : []),
      ...(by.has('department') ? [organizationDepartment.id, organizationDepartment.name] : []),
      ...(by.has('day') ? [RUN_DAY] : []),
      RUN_MODEL,
    );
  const module = await priceModule();
  const priced = await Promise.all(
    [...rows, ...unledgered].map(async (row) => {
      const price =
        module && row.model ? await module.price(row.model, row.provider).catch(() => null) : null;
      return { ...row, costEur: costOf(row, price) };
    }),
  );
  if (by.has('model')) return priced;
  // Merge the per-model groups the caller did not ask for.
  const merged = new Map<string, UsageRow>();
  for (const row of priced) {
    const key = JSON.stringify([
      row.issueId,
      row.agentId,
      row.projectId,
      row.goalId,
      row.departmentId,
      row.day,
      row.kind,
    ]);
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
      'unledgeredRuns',
    ] as const) {
      into[field] += row[field];
    }
    into.costEur =
      into.costEur === null || row.costEur === null ? null : into.costEur + row.costEur;
  }
  return [...merged.values()];
}

// Whether any row of the filter had no price: the total cost is then a lower bound.
export function unpriced(rows: UsageRow[]): boolean {
  return rows.some((row) => row.costEur === null && row.inputTokens + row.outputTokens > 0);
}
