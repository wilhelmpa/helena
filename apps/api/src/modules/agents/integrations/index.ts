import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { paginate } from '#shared/pagination';
import { teamParams } from '#modules/teams/model';
import { INTEGRATION_CATALOG } from './catalog';
import {
  CredentialPageResponse,
  credentialListQuery,
  CredentialResponse,
  IntegrationCatalogResponse,
  IntegrationOptionListResponse,
  createCredentialBody,
  credentialParams,
  integrationOptionsQuery,
  updateCredentialBody,
} from './model';
import {
  listCredentials,
  listCredentialOptions,
  createCredential,
  updateCredential,
  deleteCredential,
} from './service';

// The credential store belongs to the team and serves every project it owns, so every
// route sits under :teamId, gated by the integrations resource on the team: its owner
// and managers always, an owner of one of its projects always, another member when a
// project role of theirs grants it. The catalog and the picker options are open to any
// team member — the catalog is a constant of this codebase, and the options carry no
// credential field. The writes are not
// exposed as MCP tools, because a credential body carries the provider's secret in
// plain text.
export const integrationRoutes = new Elysia({
  name: 'integrations',
  detail: { tags: ['Integrations'] },
})
  .use(authContext)
  .use(guards)

  // The frontend builds the credential form from credentialSchema. Open to any team
  // member: the catalog is a constant in this codebase, not team data.
  .get('/teams/:teamId/integrations/catalog', () => INTEGRATION_CATALOG, {
    params: teamParams,
    teamMember: true,
    response: { 200: IntegrationCatalogResponse, ...accessErrors },
    detail: {
      summary: 'List available integrations',
      description:
        "List the integration catalog: the tool integrations (kind 'tool') a credential can " +
        'be stored for, each with its credential fields and its tools.',
      ...mcpTool('list_integrations'),
    },
  })

  // Fills the credential selects in the tool and MCP server forms. Open to any team member,
  // and deliberately separate from the credential list below: that one is the
  // integrations admin view and may grow fields this one must not carry.
  .get(
    '/teams/:teamId/integrations/options',
    async ({ membership, query }) =>
      (await listCredentialOptions(membership.teamId)).filter(
        (option) => !query.kind || option.kind === query.kind,
      ),
    {
      params: teamParams,
      query: integrationOptionsQuery,
      teamMember: true,
      response: { 200: IntegrationOptionListResponse, ...commonErrors },
      detail: {
        summary: 'List integration options',
        description:
          "The team's connected integrations as picker options: id, key, kind and label. " +
          "Kind 'secret' lists the team's secrets and API keys an MCP server may name.",
      },
    },
  )

  .get(
    '/teams/:teamId/integrations',
    ({ membership, query }) =>
      paginate(query, (window) => listCredentials(membership.teamId, window)),
    {
      params: teamParams,
      query: credentialListQuery,
      teamPermission: ['integrations', 'read'],
      response: { 200: CredentialPageResponse, ...accessErrors },
      detail: {
        summary: 'List credentials',
        description:
          "One page of a team's integration credentials, secrets redacted. A credential is " +
          'added in the UI, not here.',
        ...mcpTool('list_integration_credentials'),
      },
    },
  )

  .post(
    '/teams/:teamId/integrations',
    async ({ membership, body, set }) => {
      set.status = 201;
      return createCredential(membership.teamId, body);
    },
    {
      params: teamParams,
      body: createCredentialBody,
      teamPermission: ['integrations', 'create'],
      response: { 201: CredentialResponse, ...commonErrors },
      detail: {
        summary: 'Add a credential',
        description: 'Store a credential for an integration.',
      },
    },
  )

  // Updates the label and/or the credential. Secret fields left out of `credential`
  // keep their stored value. The integration is fixed once created (delete + re-add).
  .patch(
    '/teams/:teamId/integrations/:credentialId',
    async ({ params, membership, body }) => {
      const row = await updateCredential(params.credentialId, membership.teamId, body);
      if (!row) throw new HttpError(404, 'Credential not found');
      return row;
    },
    {
      body: updateCredentialBody,
      params: credentialParams,
      teamPermission: ['integrations', 'edit'],
      response: { 200: CredentialResponse, ...commonErrors },
      detail: {
        summary: 'Update a credential',
        description: "Update a credential's label or secret. The integration is fixed.",
      },
    },
  )

  .delete(
    '/teams/:teamId/integrations/:credentialId',
    async ({ params, membership }) => {
      const ok = await deleteCredential(params.credentialId, membership.teamId);
      if (!ok) throw new HttpError(404, 'Credential not found');
      return noContent();
    },
    {
      params: credentialParams,
      teamPermission: ['integrations', 'delete'],
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Delete a credential',
        description: 'Delete an integration credential.',
      },
    },
  );
