import { Elysia } from 'elysia';
import {
  aiAgent,
  db,
  helenaBudget,
  issue,
  organizationDepartment,
  organizationGoal,
  project,
} from '@repo/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { commonErrors } from '#shared/responses';
import { runsTeam } from '#modules/teams/service';
import { memberProjectIds } from '../core/service';
import { agentForPerson } from '../people-access';
import {
  BudgetSummaryResponse,
  UsageResponse,
  budgetSummaryQuery,
  teamParams,
  usageQuery,
  type UsageDimensionName,
} from './model';
import { unpriced, usageBy, type UsageRow } from './service';
import { budgetStatuses } from '#modules/autopilot/budgets';
import { periodStart } from '#modules/autopilot/usage';

const DIMENSIONS: UsageDimensionName[] = [
  'issue',
  'agent',
  'model',
  'project',
  'goal',
  'department',
  'day',
  'kind',
];
const DAY_MS = 86_400_000;
const MAX_DAYS = 400;

function day(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Invalid date');
  return parsed;
}

function sum(rows: UsageRow[]) {
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    durationMs: 0,
    entries: 0,
    unledgeredRuns: 0,
    costEur: null as number | null,
  };
  for (const row of rows) {
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.cacheReadTokens += row.cacheReadTokens;
    total.cacheWriteTokens += row.cacheWriteTokens;
    total.reasoningTokens += row.reasoningTokens;
    total.durationMs += row.durationMs;
    total.entries += row.entries;
    total.unledgeredRuns += row.unledgeredRuns;
    if (row.costEur !== null) total.costEur = (total.costEur ?? 0) + row.costEur;
  }
  if (unpriced(rows)) total.costEur = null;
  return total;
}

// Tokens and cost of the team's agents, from the ledger, summed per agent, model, project,
// day or kind. People only; one who does not run the team sees the projects they belong to.
export const agentUsageRoutes = new Elysia({
  name: 'agent-usage',
  detail: { tags: ['Agent Usage'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/budget-summary',
    async ({ membership, query }) => {
      const period = query.period ?? 'month';
      const from = periodStart(period);
      const to = new Date(Date.now() + DAY_MS);
      const [rows, agents, projects, goals, departments, issues] = await Promise.all([
        usageBy({ teamId: membership.teamId, from, to }, [
          'issue',
          'agent',
          'project',
          'goal',
          'department',
        ]),
        db.select({ id: aiAgent.id }).from(aiAgent).where(eq(aiAgent.teamId, membership.teamId)),
        db.select({ id: project.id }).from(project).where(eq(project.teamId, membership.teamId)),
        db
          .select({ id: organizationGoal.id })
          .from(organizationGoal)
          .where(eq(organizationGoal.teamId, membership.teamId)),
        db
          .select({ id: organizationDepartment.id })
          .from(organizationDepartment)
          .where(eq(organizationDepartment.teamId, membership.teamId)),
        db
          .select({ id: issue.id })
          .from(helenaBudget)
          .innerJoin(issue, eq(issue.id, helenaBudget.issueId))
          .innerJoin(project, eq(project.id, issue.projectId))
          .where(and(eq(project.teamId, membership.teamId), isNotNull(helenaBudget.issueId))),
      ]);
      return {
        period,
        usage: {
          from: from.toISOString().slice(0, 10),
          to: new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10),
          by: ['issue', 'agent', 'project', 'goal', 'department'] as UsageDimensionName[],
          currency: 'EUR' as const,
          unpriced: unpriced(rows),
          total: sum(rows),
          rows,
        },
        budgets: await budgetStatuses({
          issueIds: issues.map((row) => row.id),
          agentIds: agents.map((row) => row.id),
          projectIds: projects.map((row) => row.id),
          goalIds: goals.map((row) => row.id),
          departmentIds: departments.map((row) => row.id),
        }),
      };
    },
    {
      params: teamParams,
      query: budgetSummaryQuery,
      teamManager: true,
      response: { 200: BudgetSummaryResponse, ...commonErrors },
      detail: { summary: 'Read period costs and budgets for dashboard tiles' },
    },
  )

  .get(
    '/teams/:teamId/agent-usage',
    async ({ membership, query }) => {
      if (membership.role === 'agent') {
        throw new HttpError(403, 'Only a person can read what agents spent');
      }
      const today = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
      const from = day(query.from, new Date(today.getTime() - 29 * DAY_MS));
      const to = new Date(day(query.to, today).getTime() + DAY_MS);
      if (to <= from || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
        throw new HttpError(400, `Choose a range of 1 to ${MAX_DAYS} days`);
      }
      const by = (query.by ?? 'agent,model')
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is UsageDimensionName =>
          DIMENSIONS.includes(value as UsageDimensionName),
        );
      if (query.agentId !== undefined) await agentForPerson(query.agentId, membership);
      const projectIds = runsTeam(membership.role)
        ? undefined
        : await memberProjectIds(membership.teamId, membership.userId);
      const rows = await usageBy(
        {
          teamId: membership.teamId,
          from,
          to,
          agentId: query.agentId,
          projectId: query.projectId,
          projectIds,
        },
        by,
      );
      return {
        from: from.toISOString().slice(0, 10),
        to: new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10),
        by,
        currency: 'EUR' as const,
        unpriced: unpriced(rows),
        total: sum(rows),
        rows,
      };
    },
    {
      params: teamParams,
      query: usageQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: UsageResponse, ...commonErrors },
      detail: {
        summary: 'Read what the agents spent',
        description:
          'Tokens (OpenTelemetry GenAI counts) and cost in euro of the runs, chat answers and ' +
          "reflections of the team's agents, summed by the chosen dimensions. Finished runs " +
          'without a ledger row are included from their run totals and counted as unledgeredRuns. ' +
          'The last 30 days unless a range is given.',
      },
    },
  );
