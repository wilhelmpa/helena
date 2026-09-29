import { Elysia, t } from 'elysia';
import { aiAgent, agentRun, db } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { tradingQuestions, type TradingDecisionKind } from '@helena/trading';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import {
  assertMcpEnabled,
  requireProjectAccess,
  requireTeamPermission,
  requireUser,
} from '#shared/access';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { decide } from '#modules/decisions/service';
import { ApprovalResponse } from '#modules/approvals/model';
import { getCallingAgent } from '#modules/approvals/service';
import { requestStrategyApproval } from './strategies';
import {
  classifyBody,
  ClassifyResponse,
  tradingProjectParams,
  strategyApprovalBody,
  tradingDashboardQuery,
  TradingDashboardResponse,
  tradingWidgetsQuery,
} from './model';
import { assertClassificationShape, classificationInput } from './classify-input';
import { tradingDashboardData } from './dashboard';
import { tradingWidgetData } from './widget-data';

// The trading decisions as one agent tool (docs/helena-decisions/trading.md §6): sort a news
// item, check a planned trade against one written rule, or route a task. The questions are
// the classes' own, so what is asked is what their evals measured. Sorting only: never an
// entry or exit signal.

async function callerAgentId(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

async function runOf(header: string | null, agentId: number | null): Promise<number | null> {
  const runId = Number(header);
  if (!agentId || !Number.isInteger(runId) || runId <= 0) return null;
  const [row] = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId)));
  return row?.id ?? null;
}

export const tradingRoutes = new Elysia({ name: 'trading', detail: { tags: ['Trading'] } })
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/trading/widgets',
    async ({ project, user, query }) => {
      await requireTeamPermission(project.teamId, user, 'agent_tools', 'read');
      return tradingWidgetData(project, query.period ?? 'today', query.credentialId);
    },
    {
      permission: ['dashboards', 'read'],
      feature: 'dashboards',
      params: tradingProjectParams,
      query: tradingWidgetsQuery,
      response: {
        200: t.Record(t.String(), t.Object({ data: t.Any(), error: t.Nullable(t.String()) })),
        ...commonErrors,
      },
      detail: { summary: 'Read paper Trading widgets' },
    },
  )
  .get(
    '/projects/:projectKey/trading/dashboard',
    ({ project, query }) =>
      tradingDashboardData(project.id, project.teamId, query.period ?? 'today'),
    {
      permission: ['dashboards', 'read'],
      feature: 'dashboards',
      params: tradingProjectParams,
      query: tradingDashboardQuery,
      response: { 200: TradingDashboardResponse, ...commonErrors },
      detail: { summary: 'Read the Trading dashboard from project data' },
    },
  )
  .post(
    '/projects/:projectKey/trading/strategies/approval',
    async ({ project, user, body, set }) => {
      const agent = await getCallingAgent(requireUser(user).id, project.teamId);
      if (!agent) throw new HttpError(403, 'Only an agent can request a strategy approval.');
      const result = await requestStrategyApproval({ project, agent, ...body });
      set.status = result.created ? 201 : 200;
      return result.approval;
    },
    {
      projectMember: true,
      params: tradingProjectParams,
      body: strategyApprovalBody,
      response: {
        200: ApprovalResponse,
        201: ApprovalResponse,
        ...commonErrors,
        ...errors(409, 413, 502),
      },
      detail: {
        summary: 'Request human approval of a paper strategy snapshot',
        description:
          'Reads the canonical strategy version note in this project and files its complete content for a person to approve. Requires status paper, instruments and a backtest reference. No order is placed. Every order still obeys the paper account limits. A changed note, account or project needs its own approval; setting frontmatter freigabe never approves a strategy.',
        ...mcpTool('trading_request_strategy_approval', {}, 'write'),
      },
    },
  )
  .post(
    '/projects/:projectKey/trading/classify',
    async ({ params, user, body, request }) => {
      const project = await requireProjectAccess(params.projectKey, user);
      assertMcpEnabled(project, isMcpRequest(request.headers));
      const input = classificationInput(body);
      let asked: ReturnType<typeof tradingQuestions>;
      try {
        asked = tradingQuestions(body.kind as TradingDecisionKind, input.rule);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const agentId = await callerAgentId(requireUser(user).id);
      const outcome = await decide({
        teamId: project.teamId,
        classId: asked.classId,
        context: input.context,
        localOnly: input.localOnly,
        questions: asked.questions,
        subject: `trading:${body.kind}`,
        projectId: project.id,
        agentId,
        runId: await runOf(request.headers.get('x-helena-run'), agentId),
      });
      const answers = Object.fromEntries(
        Object.entries(asked.questions).map(([key, question]) => {
          const answer = outcome.answers[key];
          const choice = answer?.choice ?? null;
          const label =
            choice === null
              ? null
              : question.kind === 'yesno'
                ? choice
                : (question.options?.find((option) => option.id === choice)?.label ?? null);
          return [
            key,
            { choice, label, confidence: answer?.confidence ?? null, decided: !!answer?.decided },
          ];
        }),
      );
      return {
        status: outcome.status,
        answers,
        threshold: outcome.threshold,
        model: outcome.model,
        latencyMs: outcome.latencyMs,
      };
    },
    {
      params: tradingProjectParams,
      body: classifyBody,
      transform: ({ body }) => assertClassificationShape(body),
      response: { 200: ClassifyResponse, ...commonErrors, ...errors(400) },
      detail: {
        summary: 'Sort news, check a rule or route a task (trading)',
        description:
          "Ask the trading project's small decision model, in well under a few seconds: " +
          "kind 'news' sorts one news item (instrument relevance, direction, kind of " +
          'event). Public cloud-eligible news uses only publicNews: articleText, instrument names and publicDataConfirmed:true; ' +
          'this is the caller’s explicit sharing declaration, not a verified public source. Never include private account or position data. ' +
          'Omit context for this mode; legacy context stays local through all attempts. Team/use-case Off controls the optional stage; chat /jev Off is not a trading-tool gate. ' +
          "kind 'rule' says whether a planned paper trade meets one written rule of " +
          "Regelwerk.md; kind 'routing' names the role of the trading team for a task. Act on " +
          'an answer only when it is decided; otherwise judge yourself. It is never an entry ' +
          'or exit signal, and it writes nothing.',
        ...mcpTool('trading_classify', { readOnlyHint: true }, 'read'),
      },
    },
  );
