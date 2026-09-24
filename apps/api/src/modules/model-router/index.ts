import { Elysia, t } from 'elysia';
import { db, project } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireTeamMembership, requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { listTeams } from '#modules/teams/service';
import { routePrompt } from './prompt';
import { routerOverview, setAgentRouter, setProjectRouter } from './service';

// The model router's switches (per agent, per project), its recent decisions, and the endpoint
// the owner's Claude Code hook asks (docs/helena-decisions/decisions.md §4).

const RouteView = t.Object({
  id: t.Number(),
  agentId: t.Number(),
  runId: t.Nullable(t.Number()),
  chatMessageId: t.Nullable(t.Number()),
  fromModel: t.String(),
  toModel: t.String(),
  routed: t.Boolean(),
  tier: t.Nullable(t.String()),
  confidence: t.Nullable(t.Number()),
  needsContext: t.Nullable(t.Number()),
  reason: t.String(),
  createdAt: t.String(),
});

const RouterOverview = t.Object({
  agents: t.Array(
    t.Object({
      id: t.Number(),
      name: t.String(),
      model: t.Nullable(t.String()),
      enabled: t.Boolean(),
      allowUpgrade: t.Boolean(),
    }),
  ),
  projects: t.Array(
    t.Object({ id: t.Number(), key: t.String(), name: t.String(), enabled: t.Boolean() }),
  ),
  recent: t.Array(RouteView),
});

const PromptRoute = t.Object({
  decision: t.Union([t.Literal('delegate'), t.Literal('handle'), t.Literal('none')]),
  status: t.String(),
  tier: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  sessionModel: t.String(),
  confidence: t.Nullable(t.Number()),
  needsContext: t.Nullable(t.Number()),
  latencyMs: t.Nullable(t.Number()),
  note: t.String(),
  decisionId: t.Nullable(t.Number()),
});

export const modelRouterRoutes = new Elysia({
  name: 'model-router',
  detail: { tags: ['Decisions'] },
})
  .use(authContext)
  .use(guards)

  .post(
    '/model-router/prompt',
    async ({ user, body }) => {
      const current = requireUser(user);
      let teamId = body.teamId ?? null;
      if (teamId) await requireTeamMembership(teamId, user);
      else {
        const teams = await listTeams(current.id);
        if (teams.length !== 1) throw new HttpError(400, 'Name the team (teamId).');
        teamId = teams[0]!.id;
      }
      try {
        return await routePrompt({
          teamId,
          prompt: body.prompt,
          sessionModel: body.sessionModel ?? 'opus',
          sessionId: body.sessionId ?? null,
        });
      } catch (error) {
        console.error('[model-router] prompt route failed', error);
        return {
          decision: 'none' as const,
          status: 'error',
          tier: null,
          model: null,
          sessionModel: body.sessionModel ?? 'opus',
          confidence: null,
          needsContext: null,
          latencyMs: null,
          note: '',
          decisionId: null,
        };
      }
    },
    {
      body: t.Object({
        prompt: t.String({ maxLength: 100_000 }),
        sessionModel: t.Optional(t.String({ maxLength: 100 })),
        sessionId: t.Optional(t.String({ maxLength: 200 })),
        teamId: t.Optional(t.Integer({ minimum: 1 })),
      }),
      response: { 200: PromptRoute, ...errors(400, 401, 403, 404) },
      detail: {
        summary: 'Route a Claude Code prompt',
        description:
          "The owner's Claude Code hook asks before each prompt whether a cheaper Claude tier " +
          'can handle it as a subagent. Only the prompt text is sent. Always answers; ' +
          '`decision: none` means no advice.',
      },
    },
  )

  .get('/teams/:teamId/model-router', ({ membership }) => routerOverview(membership.teamId), {
    params: t.Object({ teamId: t.Numeric() }),
    teamManager: true,
    response: { 200: RouterOverview, ...commonErrors },
    detail: {
      summary: "Read the model router's switches",
      description:
        'Per agent whether its runs and chat answers may go to a cheaper model (off by ' +
        'default) and whether a stronger one is allowed, per project whether the router ' +
        'may act there (on by default), and its last decisions.',
    },
  })

  .put(
    '/teams/:teamId/model-router/agents/:agentId',
    ({ membership, params, body, user }) =>
      setAgentRouter(membership.teamId, params.agentId, body, user?.id ?? null),
    {
      params: t.Object({ teamId: t.Numeric(), agentId: t.Numeric() }),
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        allowUpgrade: t.Optional(t.Boolean()),
      }),
      teamManager: true,
      response: {
        200: t.Object({ enabled: t.Boolean(), allowUpgrade: t.Boolean() }),
        ...commonErrors,
      },
      detail: { summary: 'Switch the model router for an agent' },
    },
  )

  .put(
    '/teams/:teamId/model-router/projects/:projectId',
    async ({ membership, params, body, user }) => {
      const [row] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, params.projectId), eq(project.teamId, membership.teamId)));
      if (!row) throw new HttpError(404, 'Project not found');
      return setProjectRouter(membership.teamId, row.id, body.enabled, user?.id ?? null);
    },
    {
      params: t.Object({ teamId: t.Numeric(), projectId: t.Numeric() }),
      body: t.Object({ enabled: t.Boolean() }),
      teamManager: true,
      response: { 200: t.Object({ enabled: t.Boolean() }), ...commonErrors },
      detail: { summary: 'Allow or forbid the model router in a project' },
    },
  );
