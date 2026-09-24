import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import {
  BrowserGatewayOverviewResponse,
  BrowserGatewaySettingsResponse,
  browserGatewayProjectParams,
  updateBrowserGatewaySettingsBody,
} from './model';
import {
  getBrowserGatewaySettings,
  listBrowserGatewayOverview,
  setBrowserGatewaySettings,
} from './service';
import { listBrowserGatewayEvents } from './events';

// A project's browser gateway settings (design §8: "Projekt → Einstellungen → Browser") and
// its own slice of the Aktivität feed. Same permission scope as the agent network settings
// next to it in the settings nav (agent-egress/index.ts) — both are "how far an agent's
// tools reach" settings of the project.
export const agentBrowserGatewayRoutes = new Elysia({
  name: 'agent-browser-gateway',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/browser-gateway/overview',
    async ({ user }) => ({ projects: await listBrowserGatewayOverview(requireUser(user).id) }),
    {
      response: { 200: BrowserGatewayOverviewResponse, ...errors(401) },
      detail: {
        summary: 'List the projects with a project browser',
        description:
          'Every project you are a member of, with the slug of its project browser, for the ' +
          'Home "Browser" overview (design §5). The live state of each browser comes from the ' +
          'browser router.',
      },
    },
  )
  .get(
    '/projects/:projectKey/settings/browser-gateway',
    ({ project }) => getBrowserGatewaySettings(project.id),
    {
      params: browserGatewayProjectParams,
      permission: ['ai_agents', 'read'],
      response: { 200: BrowserGatewaySettingsResponse, ...accessErrors },
      detail: {
        summary: "Get a project's browser gateway settings",
        description:
          'The domain blocklist and optional allowlist the project browser gateway enforces on ' +
          "navigation, whether it types and clicks with human-like timing, and the agents' " +
          'control lock timeout.',
      },
    },
  )
  .put(
    '/projects/:projectKey/settings/browser-gateway',
    ({ project, body }) => setBrowserGatewaySettings(project.id, body),
    {
      params: browserGatewayProjectParams,
      body: updateBrowserGatewaySettingsBody,
      permission: ['ai_agents', 'edit'],
      response: { 200: BrowserGatewaySettingsResponse, ...commonErrors },
      detail: {
        summary: "Update a project's browser gateway settings",
      },
    },
  )
  .get(
    '/projects/:projectKey/browser-gateway/events',
    ({ project, query }) => listBrowserGatewayEvents(project.id, query),
    {
      params: browserGatewayProjectParams,
      query: t.Object({ limit: t.Optional(t.Numeric()), before: t.Optional(t.Numeric()) }),
      permission: ['ai_agents', 'read'],
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.Number(),
              agentId: t.Nullable(t.Number()),
              agentName: t.String(),
              actor: t.Union([t.Literal('agent'), t.Literal('owner')]),
              tool: t.String(),
              target: t.Nullable(t.String()),
              createdAt: t.String(),
            }),
          ),
          nextBefore: t.Nullable(t.Number()),
        }),
        ...accessErrors,
      },
      detail: {
        summary: "List a project browser's recent gateway actions",
        description: 'Newest first: the tool and a short, non-secret target label, never a value.',
      },
    },
  );
