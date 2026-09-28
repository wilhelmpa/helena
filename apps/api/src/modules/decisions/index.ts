import { Elysia, t } from 'elysia';
import { aiAgent, agentRun, db, organizationAgentAssignment, projectMember } from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireProjectAccess, requireTeamMembership, requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { listTeams } from '#modules/teams/service';
import { GENERAL_CLASS } from './classes';
import {
  DecideResponse,
  FirstStageView,
  updateFirstStageBody,
  DecisionClassView,
  DecisionClassesResponse,
  DecisionEvalView,
  DecisionEvalsResponse,
  DecisionLogResponse,
  decideBody,
  decisionClassParams,
  decisionEvalParams,
  decisionEvalsQuery,
  decisionLogParams,
  decisionLogQuery,
  decisionOutcomeBody,
  startDecisionEvalBody,
  updateDecisionClassBody,
} from './model';
import { cancelEval, listEvals, startEval } from './evals-runner';
import { decide, recordOutcome } from './service';
// Decision connections to Helena's local AI (its route, server and key).
import './local-ai';
import {
  decisionConnections,
  getClassView,
  listClassViews,
  listDecisions,
  updateClassSetting,
} from './settings';
import { teamParams } from '#modules/teams/model';
import { firstStageView, updateFirstStage } from './first-stage';
import { routeTaskAgent, triageTask } from './triage';

// Typed decisions (docs/helena-decisions/decisions.md): the classes' settings, their evals
// and log for the team's owners and managers, and `decide` for agents and people — one
// question with declared options, answered with a probability per option.

// The team a decide call is asked in: the project's, the agent's own, the one named, or the
// caller's only team.
async function decideScope(
  user: Parameters<typeof requireUser>[0],
  body: { projectKey?: string; teamId?: number },
): Promise<{ teamId: number; projectId: number | null; agentId: number | null }> {
  const current = requireUser(user);
  const [agent] = await db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.userId, current.id))
    .limit(1);
  if (body.projectKey) {
    const project = await requireProjectAccess(body.projectKey, user);
    return { teamId: project.teamId, projectId: project.id, agentId: agent?.id ?? null };
  }
  if (agent) return { teamId: agent.teamId, projectId: null, agentId: agent.id };
  if (body.teamId) {
    const membership = await requireTeamMembership(body.teamId, user);
    return { teamId: membership.teamId, projectId: null, agentId: null };
  }
  const teams = await listTeams(current.id);
  if (teams.length !== 1) throw new HttpError(400, 'Name the team (teamId) or a projectKey.');
  return { teamId: teams[0]!.id, projectId: null, agentId: null };
}

// The run an agent's runtime names on its requests (x-helena-run), when it is that agent's.
async function runOf(header: string | null, agentId: number | null): Promise<number | null> {
  const runId = Number(header);
  if (!agentId || !Number.isInteger(runId) || runId <= 0) return null;
  const [row] = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId)));
  return row?.id ?? null;
}

async function projectDecisionAgents(projectId: number, teamId: number) {
  const rows = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      roleTitle: organizationAgentAssignment.roleTitle,
      capabilities: organizationAgentAssignment.capabilities,
    })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .leftJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, teamId),
      ),
    )
    .where(and(eq(aiAgent.teamId, teamId), isNull(aiAgent.pausedAt), eq(aiAgent.template, false)))
    .orderBy(asc(aiAgent.id))
    .limit(14);
  return rows.map((row) => ({
    id: `a_${row.id}`,
    label: [row.username, row.roleTitle, row.capabilities?.join(', ')]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 300),
  }));
}

export const decisionRoutes = new Elysia({
  name: 'decisions',
  detail: { tags: ['Decisions'] },
})
  .use(authContext)
  .use(guards)

  .post(
    '/projects/:projectKey/decisions/task-triage',
    async ({ user, params, body }) => {
      const project = await requireProjectAccess(params.projectKey, user);
      const candidates = await projectDecisionAgents(project.id, project.teamId);
      return triageTask({
        teamId: project.teamId,
        projectId: project.id,
        title: body.title,
        description: body.description,
        candidates,
        subject: `task-triage:${project.id}`,
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 300 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
      }),
      detail: { summary: 'Classify task responsibility and priority' },
    },
  )

  .post(
    '/projects/:projectKey/decisions/agent-route',
    async ({ user, params, body }) => {
      const project = await requireProjectAccess(params.projectKey, user);
      const candidates = await projectDecisionAgents(project.id, project.teamId);
      return routeTaskAgent({
        teamId: project.teamId,
        projectId: project.id,
        title: body.title,
        description: body.description,
        candidates,
        subject: `agent-route:${project.id}`,
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 300 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
      }),
      detail: { summary: 'Select an eligible agent for a task' },
    },
  )

  .post(
    '/decisions/decide',
    async ({ user, body, request }) => {
      const scope = await decideScope(user, body);
      const options = body.options?.map((option, index) =>
        typeof option === 'string' ? { id: String(index), label: option } : option,
      );
      const outcome = await decide({
        teamId: scope.teamId,
        classId: GENERAL_CLASS,
        context: body.context ?? '',
        questions: {
          q: options
            ? { kind: 'choice', question: body.question, options }
            : { kind: 'yesno', question: body.question },
        },
        subject: 'decide',
        projectId: scope.projectId,
        agentId: scope.agentId,
        runId: await runOf(request.headers.get('x-helena-run'), scope.agentId),
      });
      const answer = outcome.answers.q!;
      return {
        status: answer.choice === null ? outcome.status : answer.decided ? 'decided' : 'unsure',
        choice: answer.choice,
        label:
          answer.choice === null
            ? null
            : options
              ? (options.find((option) => option.id === answer.choice)?.label ?? null)
              : answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        threshold: outcome.threshold,
        backend: outcome.backend,
        model: outcome.model,
        latencyMs: outcome.latencyMs,
        decisionId: answer.decisionId,
      };
    },
    {
      body: decideBody,
      response: { 200: DecideResponse, ...errors(400, 401, 403, 404) },
      detail: {
        summary: 'Decide a question among fixed options',
        description:
          'Ask a small decision model (Jev, Laya or a local model, as the team configured the ' +
          'class "Allgemeine Entscheidungen") to pick one of the given options — or yes/no when ' +
          'no options are given — about the context. It answers in well under a second with a ' +
          'probability per option. Use it for classification and routing questions whose answer ' +
          'is one of a known list; act on `choice` only when `status` is "decided", otherwise ' +
          'decide yourself. It never writes anything.',
        ...mcpTool('decide', { readOnlyHint: true }, 'read'),
      },
    },
  )

  .get(
    '/teams/:teamId/decisions/classes',
    async ({ membership }) => ({
      firstStage: await firstStageView(membership.teamId),
      classes: await listClassViews(membership.teamId),
      connections: await decisionConnections(membership.teamId),
    }),
    {
      params: teamParams,
      teamManager: true,
      response: { 200: DecisionClassesResponse, ...commonErrors },
      detail: {
        summary: 'List the decision classes',
        description:
          'Every kind of typed decision Helena asks (model router, mail classifier, receipt ' +
          "matching, general), with the team's setting, the newest eval on the chosen " +
          'connection, whether it can be switched on, and the last seven days in numbers.',
      },
    },
  )

  .patch(
    '/teams/:teamId/decisions/first-stage',
    ({ membership, body }) => updateFirstStage(membership.teamId, body),
    {
      params: teamParams,
      body: updateFirstStageBody,
      teamManager: true,
      response: { 200: FirstStageView, ...commonErrors, ...errors(409) },
      detail: { summary: 'Configure the optional Jev first decision stage' },
    },
  )

  .get(
    '/teams/:teamId/decisions/classes/:classId',
    ({ membership, params }) => getClassView(membership.teamId, params.classId),
    {
      params: decisionClassParams,
      teamManager: true,
      response: { 200: DecisionClassView, ...commonErrors },
      detail: { summary: 'Read a decision class' },
    },
  )

  .patch(
    '/teams/:teamId/decisions/classes/:classId',
    ({ membership, params, body, user }) =>
      updateClassSetting(membership.teamId, params.classId, body, user?.id ?? null),
    {
      params: decisionClassParams,
      body: updateDecisionClassBody,
      teamManager: true,
      response: { 200: DecisionClassView, ...commonErrors },
      detail: {
        summary: 'Change a decision class',
        description:
          'The connection that answers it, a fallback, the threshold, the failsafe, whether the ' +
          'log keeps the input, and its own options. Switching it on needs a passing eval on ' +
          'the connection (409 no_eval, eval_failed or eval_threshold otherwise).',
      },
    },
  )

  .post(
    '/teams/:teamId/decisions/classes/:classId/evals',
    async ({ membership, params, body, user, set }) => {
      set.status = 202;
      return startEval(membership.teamId, params.classId, body, user?.id ?? null);
    },
    {
      params: decisionClassParams,
      body: startDecisionEvalBody,
      teamManager: true,
      response: { 202: DecisionEvalView, ...commonErrors },
      detail: {
        summary: 'Evaluate a decision class',
        description:
          "Asks the class's labelled cases on a connection in the background and scores the " +
          'answers: precision above the threshold, coverage, latency, cost.',
      },
    },
  )

  .get(
    '/teams/:teamId/decisions/evals',
    async ({ membership, query }) => ({
      evals: await listEvals(membership.teamId, query.classId, query.limit),
    }),
    {
      params: teamParams,
      query: decisionEvalsQuery,
      teamManager: true,
      response: { 200: DecisionEvalsResponse, ...commonErrors },
      detail: { summary: 'List the evals of the decision classes' },
    },
  )

  .delete(
    '/teams/:teamId/decisions/evals/:evalId',
    async ({ membership, params }) => {
      if (!(await cancelEval(membership.teamId, params.evalId)))
        throw new HttpError(404, 'No running eval with that id.');
      return noContent();
    },
    {
      params: decisionEvalParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Cancel a running eval' },
    },
  )

  .get(
    '/teams/:teamId/decisions/log',
    ({ membership, query }) => listDecisions(membership.teamId, query),
    {
      params: teamParams,
      query: decisionLogQuery,
      teamManager: true,
      response: { 200: DecisionLogResponse, ...commonErrors },
      detail: {
        summary: 'Read the decision log',
        description:
          'Every question asked, newest first: the choice with its probability and confidence, ' +
          'the backend and model, the time, the cost, and a correction where one was made.',
      },
    },
  )

  .post(
    '/teams/:teamId/decisions/log/:decisionId/outcome',
    async ({ membership, params, body }) => {
      if (!(await recordOutcome(membership.teamId, params.decisionId, body.outcome, 'owner')))
        throw new HttpError(404, 'Decision not found.');
      return noContent();
    },
    {
      params: decisionLogParams,
      body: decisionOutcomeBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Correct a decision',
        description:
          'Records the right answer of a logged decision, for the evals and the numbers.',
      },
    },
  );
