import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { commonErrors } from '#shared/responses';
import { runsTeam } from '#modules/teams/service';
import { memberProjectIds } from '../core/service';
import { agentForPerson } from '../people-access';
import { UsageResponse, teamParams, usageQuery, type UsageDimensionName } from './model';
import { unpriced, usageBy, type UsageRow } from './service';

const DIMENSIONS: UsageDimensionName[] = ['agent', 'model', 'project', 'day', 'kind'];
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
    if (row.costEur !== null) total.costEur = (total.costEur ?? 0) + row.costEur;
  }
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
          "reflections of the team's agents, summed by the chosen dimensions. The last 30 days " +
          'unless a range is given.',
      },
    },
  );
