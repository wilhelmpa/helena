import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { teamParams } from '#modules/teams/model';
import { paginate, pageQueryFields } from '#shared/pagination';
import {
  addSource,
  adoptRevision,
  decideProposal,
  diffRevisions,
  inspectItem,
  listProposals,
  listSources,
  previewItem,
  proposeItem,
  refreshSource,
  removeSource,
  rollbackItem,
  searchCatalog,
} from './service';

const sourceParams = t.Object({ teamId: t.Numeric(), sourceId: t.Numeric() });
const itemParams = t.Object({ teamId: t.Numeric(), itemId: t.Numeric() });
const sourceBody = t.Object({
  kind: t.Union([
    t.Literal('github-skills'),
    t.Literal('npm-mcp'),
    t.Literal('pypi-mcp'),
    t.Literal('github-mcp'),
  ]),
  locator: t.String({ minLength: 1, maxLength: 300 }),
  role: t.Optional(t.String({ maxLength: 120 })),
});
const adoptBody = t.Object({
  revisionId: t.Number(),
  acknowledgeFindings: t.Optional(t.Boolean()),
  scope: t.Optional(
    t.Object({
      projectId: t.Optional(t.Number()),
      agentId: t.Optional(t.Number()),
      roleId: t.Optional(t.Number()),
    }),
  ),
});

export const catalogRoutes = new Elysia({ name: 'catalog', detail: { tags: ['Catalog'] } })
  .use(authContext)
  .use(guards)
  .get('/teams/:teamId/catalog/sources', ({ membership }) => listSources(membership.teamId), {
    params: teamParams,
    teamPermission: ['agent_skills', 'read'],
    response: { 200: t.Any(), ...accessErrors },
    detail: { summary: 'List curated catalog sources' },
  })
  .post(
    '/teams/:teamId/catalog/sources',
    ({ membership, body, set }) => {
      set.status = 201;
      return addSource(membership.teamId, body);
    },
    {
      params: teamParams,
      body: sourceBody,
      teamOwner: true,
      response: { 201: t.Any(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Add a curated catalog source' },
    },
  )
  .delete(
    '/teams/:teamId/catalog/sources/:sourceId',
    async ({ membership, params }) => {
      await removeSource(membership.teamId, params.sourceId);
      return noContent();
    },
    {
      params: sourceParams,
      teamOwner: true,
      response: { 204: t.Void(), ...accessErrors, ...errors(409) },
      detail: { summary: 'Remove a curated catalog source' },
    },
  )
  .post(
    '/teams/:teamId/catalog/sources/:sourceId/refresh',
    ({ membership, params }) => refreshSource(membership.teamId, params.sourceId),
    {
      params: sourceParams,
      teamOwner: true,
      response: { 200: t.Any(), ...commonErrors, ...errors(502) },
      detail: { summary: 'Discover items from a curated source' },
    },
  )
  .get(
    '/teams/:teamId/catalog/items',
    ({ membership, query }) =>
      paginate(query, (window) => searchCatalog(membership.teamId, query.q ?? '', window)),
    {
      params: teamParams,
      query: t.Object({ q: t.Optional(t.String({ maxLength: 120 })), ...pageQueryFields }),
      teamPermission: ['agent_skills', 'read'],
      response: { 200: t.Any(), ...accessErrors },
      detail: { summary: 'Search catalog by name, description or role' },
    },
  )
  .get(
    '/teams/:teamId/catalog/items/:itemId',
    ({ membership, params }) => previewItem(membership.teamId, params.itemId),
    {
      params: itemParams,
      teamOwner: true,
      response: { 200: t.Any(), ...accessErrors },
      detail: { summary: 'Preview item, files, license, pin and findings' },
    },
  )
  .post(
    '/teams/:teamId/catalog/items/:itemId/inspect',
    ({ membership, params }) => inspectItem(membership.teamId, params.itemId),
    {
      params: itemParams,
      teamOwner: true,
      response: { 200: t.Any(), ...commonErrors, ...errors(413, 502) },
      detail: { summary: 'Fetch and inspect a pinned version' },
    },
  )
  .get(
    '/teams/:teamId/catalog/items/:itemId/diff',
    ({ membership, params, query }) =>
      diffRevisions(membership.teamId, params.itemId, query.from, query.to),
    {
      params: itemParams,
      query: t.Object({ from: t.Numeric(), to: t.Numeric() }),
      teamOwner: true,
      response: { 200: t.Any(), ...accessErrors },
      detail: { summary: 'Compare inspected versions' },
    },
  )
  .post(
    '/teams/:teamId/catalog/items/:itemId/adopt',
    ({ membership, params, body }) =>
      adoptRevision(
        membership.teamId,
        params.itemId,
        body.revisionId,
        body.scope ?? {},
        body.acknowledgeFindings ?? false,
      ),
    {
      params: itemParams,
      body: adoptBody,
      teamOwner: true,
      response: { 200: t.Any(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Adopt inspected version and assign existing grants' },
    },
  )
  .post(
    '/teams/:teamId/catalog/items/:itemId/rollback',
    ({ membership, params }) => rollbackItem(membership.teamId, params.itemId),
    {
      params: itemParams,
      teamOwner: true,
      response: { 200: t.Any(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Restore preceding pinned version' },
    },
  )
  .get('/teams/:teamId/catalog/proposals', ({ membership }) => listProposals(membership.teamId), {
    params: teamParams,
    teamOwner: true,
    response: { 200: t.Any(), ...accessErrors },
    detail: { summary: 'List agent catalog proposals' },
  })
  .post(
    '/teams/:teamId/catalog/proposals/:proposalId/decision',
    ({ membership, params, body }) =>
      decideProposal(
        membership.teamId,
        params.proposalId,
        body.decision,
        body.revisionId,
        body.acknowledgeFindings ?? false,
      ),
    {
      params: t.Object({ teamId: t.Numeric(), proposalId: t.Numeric() }),
      body: t.Object({
        decision: t.Union([t.Literal('accepted'), t.Literal('rejected')]),
        revisionId: t.Optional(t.Number()),
        acknowledgeFindings: t.Optional(t.Boolean()),
      }),
      teamOwner: true,
      response: { 200: t.Any(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Accept or reject an agent skill suggestion' },
    },
  )
  .post(
    '/teams/:teamId/catalog/proposals',
    ({ membership, body, user, set }) => {
      set.status = 201;
      return proposeItem(
        membership.teamId,
        body.itemId,
        user!.id,
        body.agentId ?? null,
        body.reason,
      );
    },
    {
      params: teamParams,
      body: t.Object({
        itemId: t.Number(),
        agentId: t.Optional(t.Number()),
        reason: t.String({ minLength: 1, maxLength: 2000 }),
      }),
      teamPermission: ['agent_skills', 'read'],
      response: { 201: t.Any(), ...commonErrors },
      detail: {
        summary: 'Suggest a catalog skill for owner review',
        ...mcpTool('propose_catalog_skill'),
      },
    },
  );
