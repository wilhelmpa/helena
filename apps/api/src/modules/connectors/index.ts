import { Elysia, t, type TSchema } from 'elysia';
import { annotationsForCategory, connectors, declaredCategory } from '@helena/connectors';
import { GOOGLE_TOOLS } from '@helena/connectors/google';
import { trustedOrigins } from '@repo/auth';
import { mcpTool } from '#mcp/generate';
import { authContext } from '#shared/auth-context';
import { assertMcpEnabled, requireProjectAccess, requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { paginate } from '#shared/pagination';
import { accessErrors, commonErrors } from '#shared/responses';
import { teamParams } from '#modules/teams/model';
import { recordOwnerChange } from '#modules/agents/credentials/audit';
import { listAudit } from '#modules/agents/credentials/audit';
import {
  AuditPageResponse,
  CatalogResponse,
  ConnectionsResponse,
  ConnectorActionResponse,
  GogStatusResponse,
  GoogleAccountResponse,
  GoogleOverviewResponse,
  ImportClientResponse,
  SignInResponse,
  ToolCallResponse,
  accountParams,
  actionParams,
  adoptGogBody,
  auditQuery,
  clientParams,
  cloneBody,
  cloneParams,
  CloneResponse,
  McpConnectionResponse,
  McpSignInResponse,
  mcpConnectionParams,
  mcpFinishBody,
  mcpSignInBody,
  deleteGoogleAccountQuery,
  finishSignInBody,
  importClientBody,
  projectKeyParams,
  signInBody,
  updateGoogleAccountBody,
} from './model';
import { googleBroker } from './google/engine';
import { startClone } from './clone';
import { finishMcpCallback, finishMcpSignIn, getMcpConnection, startMcpSignIn } from './mcp-oauth';
import { managesTeam, teamOfConnection } from './team-access';
import {
  adoptGogAccount,
  callbackUrl,
  checkGoogleAccount,
  deleteGoogleAccount,
  deleteGoogleClient,
  finishGoogleCallback,
  finishGoogleSignIn,
  gogStatus,
  googleAccountEntry,
  importGoogleClient,
  listGoogleAccounts,
  listGoogleClients,
  startGoogleSignIn,
  updateGoogleAccount,
} from './google/service';
import { callConnectorTool, callerOf, getConnectorAction, listCallerConnections } from './tools';

// The access center's connector routes. The owner's side (team owners and managers, never
// an agent): the connector catalog, Google accounts with their OAuth clients, sign-in,
// services and health, gog, and the audit log of the whole team. The agent's side (MCP
// tools): which connections it may use, one tool per connector action, and the state of
// an action that waited for approval.

export const connectorRoutes = new Elysia({
  name: 'connectors',
  detail: { tags: ['Access center'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/connectors',
    () =>
      connectors.list().map((connector) => ({
        id: connector.id,
        label: connector.label,
        icon: connector.icon ?? null,
        kind: connector.kind,
        services: connector.services.map(({ id, label, actions }) => ({ id, label, actions })),
        tools: GOOGLE_TOOLS.filter(() => connector.id === 'google').map((tool) => ({
          name: tool.name,
          service: tool.service,
          category: declaredCategory(tool),
          gog: tool.gogCommand !== null,
        })),
      })),
    {
      params: teamParams,
      teamPermission: ['integrations', 'read'],
      response: { 200: CatalogResponse, ...commonErrors },
      detail: {
        summary: 'List the connectors',
        description:
          'What kinds of accounts and credentials Helena can hold, their services and agent tools with action categories.',
      },
    },
  )

  .get(
    '/teams/:teamId/access/audit',
    ({ membership, query }) =>
      paginate(query, (window) =>
        listAudit(
          membership.teamId,
          { credentialId: query.credentialId, actions: query.action ? [query.action] : undefined },
          window,
        ),
      ),
    {
      params: teamParams,
      query: auditQuery,
      teamPermission: ['integrations', 'read'],
      response: { 200: AuditPageResponse, ...commonErrors },
      detail: {
        summary: 'List the access audit log',
        description:
          'Every delivery, login fill, connector tool call, denial, approval request and ' +
          'owner change of the team, newest first.',
      },
    },
  )

  // ── Google ──────────────────────────────────────────────────────────────────────────────

  .get(
    '/teams/:teamId/connectors/google',
    async ({ membership }) => ({
      accounts: await listGoogleAccounts(membership.teamId),
      clients: await listGoogleClients(membership.teamId),
      gogAvailable: googleBroker() !== null,
      callbackAvailable: callbackUrl() !== null,
    }),
    {
      params: teamParams,
      teamPermission: ['integrations', 'read'],
      response: { 200: GoogleOverviewResponse, ...commonErrors },
      detail: { summary: 'List the Google accounts and OAuth clients' },
    },
  )

  .post(
    '/teams/:teamId/connectors/google/clients',
    async ({ membership, body, user }) => {
      const client = await importGoogleClient(membership.teamId, {
        json: body.json,
        label: body.label,
        engine: body.engine ?? 'helena',
      });
      if (client) await recordOwnerChange(membership.teamId, client.id, user, 'created');
      return { client };
    },
    {
      params: teamParams,
      body: importClientBody,
      teamManager: true,
      response: { 200: ImportClientResponse, ...commonErrors },
      detail: {
        summary: 'Import an OAuth client file',
        description:
          'The client JSON a Google Cloud project downloads. For the helena engine it is ' +
          'stored encrypted (its secret is never returned); for gog it is handed to gog.',
      },
    },
  )

  .delete(
    '/teams/:teamId/connectors/google/clients/:clientId',
    async ({ membership, params, user }) => {
      await recordOwnerChange(membership.teamId, params.clientId, user, 'deleted');
      if (!(await deleteGoogleClient(membership.teamId, params.clientId))) {
        throw new HttpError(404, 'OAuth client not found');
      }
      return noContent();
    },
    {
      params: clientParams,
      teamManager: true,
      response: { 204: t.Void(), ...accessErrors },
      detail: { summary: 'Delete an OAuth client' },
    },
  )

  .post(
    '/teams/:teamId/connectors/google/sign-in',
    ({ membership, body, user }) =>
      startGoogleSignIn(membership.teamId, requireUser(user).id, body),
    {
      params: teamParams,
      body: signInBody,
      teamManager: true,
      response: { 200: SignInResponse, ...commonErrors },
      detail: {
        summary: 'Start signing in to a Google account',
        description:
          'Returns the address to open. In paste mode the browser ends on an address that ' +
          'cannot be reached; paste that address back with the finish call.',
      },
    },
  )

  .post(
    '/teams/:teamId/connectors/google/sign-in/finish',
    async ({ membership, body, user }) => {
      const account = await finishGoogleSignIn(membership.teamId, requireUser(user).id, body);
      await recordOwnerChange(membership.teamId, account.id, user, 'signed-in');
      return account;
    },
    {
      params: teamParams,
      body: finishSignInBody,
      teamManager: true,
      response: { 200: GoogleAccountResponse, ...commonErrors },
      detail: { summary: 'Finish signing in to a Google account' },
    },
  )

  .get(
    '/connectors/google/oauth/callback',
    async ({ query, request, user, redirect }) => {
      const app = trustedOrigins[0] ?? '';
      const current = requireUser(user);
      try {
        if (typeof query.state !== 'string') throw new HttpError(400, 'No state.');
        const { teamId, accountId } = await finishGoogleCallback(
          query.state,
          request.url,
          current.id,
        );
        await recordOwnerChange(teamId, accountId, current, 'signed-in');
        return redirect(`${app}/access/google?connected=${accountId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The sign-in failed.';
        return redirect(`${app}/access/google?error=${encodeURIComponent(message.slice(0, 200))}`);
      }
    },
    {
      query: t.Object(
        {
          state: t.Optional(t.String()),
          code: t.Optional(t.String()),
          error: t.Optional(t.String()),
          scope: t.Optional(t.String()),
        },
        { additionalProperties: true },
      ),
      detail: { summary: "Google's return to Helena after signing in", hide: true },
    },
  )

  .patch(
    '/teams/:teamId/connectors/google/accounts/:accountId',
    async ({ membership, params, body, user }) => {
      const account = await updateGoogleAccount(membership.teamId, params.accountId, body);
      await recordOwnerChange(membership.teamId, account.id, user, 'settings');
      return account;
    },
    {
      params: accountParams,
      body: updateGoogleAccountBody,
      teamManager: true,
      response: { 200: GoogleAccountResponse, ...commonErrors },
      detail: {
        summary: 'Change a Google account',
        description:
          'Its name, its project and the services switched on. Switching Mail on gives the ' +
          'account a mailbox in the inbox that signs in with the account (no app password).',
      },
    },
  )

  .post(
    '/teams/:teamId/connectors/google/accounts/:accountId/check',
    ({ membership, params }) => checkGoogleAccount(membership.teamId, params.accountId),
    {
      params: accountParams,
      teamPermission: ['integrations', 'read'],
      response: { 200: GoogleAccountResponse, ...commonErrors },
      detail: {
        summary: 'Check a Google account',
        description: 'Asks Google whether the sign-in still works and which services it covers.',
      },
    },
  )

  .get(
    '/teams/:teamId/connectors/google/accounts/:accountId',
    ({ membership, params }) => googleAccountEntry(membership.teamId, params.accountId),
    {
      params: accountParams,
      teamPermission: ['integrations', 'read'],
      response: { 200: GoogleAccountResponse, ...commonErrors },
      detail: { summary: 'Read a Google account' },
    },
  )

  .delete(
    '/teams/:teamId/connectors/google/accounts/:accountId',
    async ({ membership, params, query, user }) => {
      await recordOwnerChange(membership.teamId, params.accountId, user, 'removed');
      await deleteGoogleAccount(membership.teamId, params.accountId, {
        fromGog: query.fromGog === true,
      });
      return noContent();
    },
    {
      params: accountParams,
      query: deleteGoogleAccountQuery,
      teamManager: true,
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Remove a Google account',
        description:
          'Ends its grants and the import of its mailbox (the imported mail stays). With ' +
          'fromGog, gog also forgets its token.',
      },
    },
  )

  .get('/teams/:teamId/connectors/google/gog', ({ membership }) => gogStatus(membership.teamId), {
    params: teamParams,
    teamManager: true,
    response: { 200: GogStatusResponse, ...commonErrors },
    detail: {
      summary: 'List the accounts gog holds',
      description: 'The accounts gog holds a token for that Helena does not list yet.',
    },
  })

  .post(
    '/teams/:teamId/connectors/google/gog/adopt',
    async ({ membership, body, user }) => {
      const account = await adoptGogAccount(membership.teamId, body);
      await recordOwnerChange(membership.teamId, account.id, user, 'listed-from-gog');
      return account;
    },
    {
      params: teamParams,
      body: adoptGogBody,
      teamManager: true,
      response: { 200: GoogleAccountResponse, ...commonErrors },
      detail: {
        summary: 'List an account gog holds',
        description: 'No token moves: Helena reaches the account through gog.',
      },
    },
  )

  .post(
    '/teams/:teamId/credentials/:credentialId/clone',
    async ({ membership, params, body, user }) => {
      const started = await startClone(membership.teamId, params.credentialId, body);
      await recordOwnerChange(
        membership.teamId,
        params.credentialId,
        user,
        'clone',
        `${body.url} → ${[started.folder, started.name].filter(Boolean).join('/') || '.'}`,
      );
      return started;
    },
    {
      params: cloneParams,
      body: cloneBody,
      teamManager: true,
      response: { 200: CloneResponse, ...commonErrors },
      detail: {
        summary: 'Clone a repository into an area folder',
        description:
          'The runner of an agent working in the project clones the repository with this ' +
          "SSH key into the area's folder of the workspace, which then ignores it.",
      },
    },
  )

  // ── MCP servers with OAuth ──────────────────────────────────────────────────────────────

  .post(
    '/teams/:teamId/connectors/mcp-oauth',
    ({ membership, body }) => startMcpSignIn(membership.teamId, body),
    {
      params: teamParams,
      body: mcpSignInBody,
      teamManager: true,
      response: { 200: McpSignInResponse, ...commonErrors },
      detail: {
        summary: 'Connect an MCP server that signs in with OAuth',
        description:
          'Discovers the server, registers Helena as its client and returns the address to ' +
          'sign in at. In paste mode, paste the address the browser ended on with the ' +
          'finish call.',
      },
    },
  )

  .post(
    '/teams/:teamId/connectors/mcp-oauth/:connectionId/sign-in',
    async ({ membership, params }) => {
      await getMcpConnection(membership.teamId, params.connectionId);
      return startMcpSignIn(membership.teamId, { id: params.connectionId });
    },
    {
      params: mcpConnectionParams,
      teamManager: true,
      response: { 200: McpSignInResponse, ...commonErrors },
      detail: { summary: 'Sign in to an MCP server again' },
    },
  )

  .post(
    '/teams/:teamId/connectors/mcp-oauth/:connectionId/finish',
    async ({ membership, params, body, user }) => {
      const row = await finishMcpSignIn(membership.teamId, params.connectionId, body.redirectUrl);
      await recordOwnerChange(membership.teamId, row.id, user, 'signed-in');
      return {
        id: row.id,
        label: row.label,
        serverUrl: String(row.readable.serverUrl ?? ''),
        status: row.status,
        statusDetail: row.statusDetail,
      };
    },
    {
      params: mcpConnectionParams,
      body: mcpFinishBody,
      teamManager: true,
      response: { 200: McpConnectionResponse, ...commonErrors },
      detail: { summary: 'Finish signing in to an MCP server' },
    },
  )

  .get(
    '/connectors/mcp-oauth/callback',
    async ({ query, request, user, redirect }) => {
      const app = trustedOrigins[0] ?? '';
      const current = requireUser(user);
      try {
        if (typeof query.state !== 'string') throw new HttpError(400, 'No state.');
        await finishMcpCallback(
          async (id) => {
            const team = await teamOfConnection(id);
            // Only an owner or manager of the connection's team finishes its sign-in.
            if (team === null || !(await managesTeam(team, current.id))) return null;
            return team;
          },
          query.state,
          request.url,
        );
        return redirect(`${app}/access/credentials?connected=1`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The sign-in failed.';
        return redirect(
          `${app}/access/credentials?error=${encodeURIComponent(message.slice(0, 200))}`,
        );
      }
    },
    {
      query: t.Object(
        {
          state: t.Optional(t.String()),
          code: t.Optional(t.String()),
          error: t.Optional(t.String()),
        },
        { additionalProperties: true },
      ),
      detail: { summary: "An MCP server's return to Helena after signing in", hide: true },
    },
  )

  // ── Agents ──────────────────────────────────────────────────────────────────────────────

  .get(
    '/projects/:projectKey/connections',
    async ({ params, user, request }) => {
      const project = await requireProjectAccess(params.projectKey, user);
      assertMcpEnabled(project, isMcpRequest(request.headers));
      return listCallerConnections(await callerOf(requireUser(user).id, project));
    },
    {
      params: projectKeyParams,
      response: { 200: ConnectionsResponse, ...commonErrors },
      detail: {
        summary: 'List your connections',
        description:
          'The Google accounts, website logins, SSH keys and environment variables granted ' +
          'to you in this project, with the services and tools you may use on each and ' +
          'whether you may only read. Secrets never appear: a login is filled by the browser, ' +
          'an SSH key reaches git through your runner, and an environment variable (e.g. ' +
          'CLOUDFLARE_API_TOKEN for wrangler) is set for your commands — use it as $NAME and ' +
          'never print a secret one.',
        ...mcpTool('list_connections'),
      },
    },
  )

  .get(
    '/projects/:projectKey/connection-actions/:actionId',
    async ({ params, user, request }) => {
      const project = await requireProjectAccess(params.projectKey, user);
      assertMcpEnabled(project, isMcpRequest(request.headers));
      const caller = await callerOf(requireUser(user).id, project);
      return getConnectorAction(params.actionId, caller.agent.id);
    },
    {
      params: actionParams,
      response: { 200: ConnectorActionResponse, ...commonErrors },
      detail: {
        summary: 'Read a connection action',
        description:
          'An action that waited for the owner: pending, running, done (with its result), ' +
          'failed or rejected.',
        ...mcpTool('get_connection_action'),
      },
    },
  );

// One MCP tool per connector action, from the registry: the body is the tool's own input
// schema, the category sets the annotations, and the tool is listed only to agents that
// hold a grant on an account of its connector.
function toolRoutes() {
  const plugin = new Elysia({ name: 'connector-tools', detail: { tags: ['Access center'] } })
    .use(authContext)
    .use(guards);
  for (const tool of GOOGLE_TOOLS) {
    const category = declaredCategory(tool);
    plugin.post(
      `/projects/:projectKey/connections/${tool.name}`,
      async ({ params, user, request, body }) => {
        const project = await requireProjectAccess(params.projectKey, user);
        assertMcpEnabled(project, isMcpRequest(request.headers));
        const caller = await callerOf(requireUser(user).id, project);
        return callConnectorTool(caller, tool.name, body as Record<string, unknown>);
      },
      {
        params: projectKeyParams,
        body: tool.inputSchema as unknown as TSchema,
        response: { 200: ToolCallResponse, ...commonErrors },
        detail: {
          summary: tool.name,
          description: tool.description,
          ...mcpTool(
            tool.name,
            { ...annotationsForCategory(category), idempotentHint: category === 'read' },
            category,
            // Google's services are outside the agent's workspace.
            'external',
            'google',
          ),
        },
      },
    );
  }
  return plugin;
}

export const connectorToolRoutes = toolRoutes();
