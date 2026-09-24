import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { teamParams } from '#modules/teams/model';
import {
  bundleOffers,
  exportTemplateBundle,
  importTemplateBundle,
  type CallerHeaders,
} from './service';

// "Vorlagen importieren/exportieren" in the agent pool: template bundles (@helena/sdk
// TemplateBundle, docs/helena-decisions/template-bundles.md) in and out of a team. The
// work runs with the caller's own credential against the regular routes, so a person who
// may not create agents cannot import any.

const BundleReport = t.Object({
  lines: t.Array(t.String()),
  written: t.Number(),
  unchanged: t.Number(),
  drift: t.Number(),
  warnings: t.Number(),
  summary: t.String(),
});

const BundleOfferView = t.Object({
  id: t.String(),
  label: t.String(),
  description: t.Nullable(t.String()),
  pluginId: t.String(),
  version: t.String(),
  agents: t.Number(),
  skills: t.Number(),
  mcpServers: t.Number(),
});

function callerOf(request: Request): CallerHeaders {
  return {
    cookie: request.headers.get('cookie'),
    apiKey: request.headers.get('x-api-key'),
    authorization: request.headers.get('authorization'),
  };
}

export const templateBundleRoutes = new Elysia({
  name: 'template-bundles',
  detail: { tags: ['Agents'] },
})
  .use(authContext)
  .use(guards)
  .get('/teams/:teamId/template-bundles/offers', () => bundleOffers(), {
    params: teamParams,
    teamPermission: ['ai_agents', 'read'],
    response: { 200: t.Array(BundleOfferView), ...accessErrors },
    detail: {
      summary: 'List the template bundles on offer (Helena and plugins)',
      description:
        "The repository's bundles (the agent pool) and those plugins register, with how many agent templates, skills and MCP servers each holds.",
    },
  })
  .post(
    '/teams/:teamId/template-bundles/import',
    ({ membership, body, request }) =>
      importTemplateBundle(membership.teamId, callerOf(request), body),
    {
      params: teamParams,
      teamPermission: ['ai_agents', 'create'],
      body: t.Object({
        // A bundle document (upload), or the id of one on offer.
        bundle: t.Optional(t.Unknown()),
        offer: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        dryRun: t.Optional(t.Boolean()),
        update: t.Optional(t.Boolean()),
      }),
      response: { 200: BundleReport, ...commonErrors },
      detail: {
        summary: 'Import a template bundle into the team',
        description:
          'Creates the agent templates, skills and MCP servers the team is missing. What ' +
          'exists but differs is reported as drift and only overwritten with update.',
      },
    },
  )
  .get(
    '/teams/:teamId/template-bundles/export',
    ({ membership, query, request }) =>
      exportTemplateBundle(membership.teamId, callerOf(request), {
        agents: query.agents?.split(',').filter(Boolean),
        name: query.name,
        displayName: query.displayName,
        version: query.version,
      }),
    {
      params: teamParams,
      teamPermission: ['ai_agents', 'read'],
      query: t.Object({
        agents: t.Optional(t.String()),
        name: t.Optional(t.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' })),
        displayName: t.Optional(t.String({ maxLength: 200 })),
        version: t.Optional(t.String({ maxLength: 50 })),
      }),
      response: { 200: t.Unknown(), ...accessErrors, ...errors(400) },
      detail: {
        summary: "Export the team's agent templates as a template bundle",
        description:
          'Reads the templates, their skills and MCP servers into one TemplateBundle document (no secrets, ids or people).',
      },
    },
  );
