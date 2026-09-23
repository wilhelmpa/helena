import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { teamParams } from '#modules/teams/model';
import { agentInTeam, agentScopeOf } from '../core/service';
import {
  McpServerListResponse,
  McpServerResponse,
  agentParams,
  createMcpServerBody,
  mcpServerParams,
  setAgentMcpServersBody,
  updateMcpServerBody,
} from './model';
import {
  createMcpServer,
  deleteMcpServer,
  listAgentMcpServers,
  listMcpServers,
  setAgentMcpServers,
  updateMcpServer,
} from './service';

// The team's MCP server library, and the servers enabled on each of its agents. A server
// starts a command on the machine the agents run on, so none of these routes is an MCP
// tool: the owner configures them in the UI. The library is small, so its list is whole.
export const agentMcpServerRoutes = new Elysia({
  name: 'agent-mcp-servers',
  detail: { tags: ['Agent MCP Servers'] },
})
  .use(authContext)
  .use(guards)

  .get('/teams/:teamId/mcp-servers', ({ membership }) => listMcpServers(membership.teamId), {
    params: teamParams,
    teamPermission: ['agent_tools', 'read'],
    response: { 200: McpServerListResponse, ...accessErrors },
    detail: {
      summary: 'List MCP servers',
      description: "The team's MCP server library. A secret is named, its value never returned.",
    },
  })

  .post(
    '/teams/:teamId/mcp-servers',
    async ({ membership, body, set }) => {
      set.status = 201;
      return createMcpServer(membership.teamId, body);
    },
    {
      params: teamParams,
      body: createMcpServerBody,
      teamPermission: ['agent_tools', 'create'],
      response: { 201: McpServerResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Add an MCP server',
        description:
          'Add an MCP server to the library: a stdio command with its arguments and ' +
          'environment, or an http or sse URL with its headers.',
      },
    },
  )

  .patch(
    '/teams/:teamId/mcp-servers/:mcpServerId',
    async ({ params, membership, body }) => {
      const row = await updateMcpServer(params.mcpServerId, membership.teamId, body);
      if (!row) throw new HttpError(404, 'MCP server not found');
      return row;
    },
    {
      params: mcpServerParams,
      body: updateMcpServerBody,
      teamPermission: ['agent_tools', 'edit'],
      response: { 200: McpServerResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Update an MCP server',
        description:
          'Change an MCP server of the library. The fields its transport does not use are ' +
          'cleared.',
      },
    },
  )

  .delete(
    '/teams/:teamId/mcp-servers/:mcpServerId',
    async ({ params, membership }) => {
      const ok = await deleteMcpServer(params.mcpServerId, membership.teamId);
      if (!ok) throw new HttpError(404, 'MCP server not found');
      return noContent();
    },
    {
      params: mcpServerParams,
      teamPermission: ['agent_tools', 'delete'],
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Delete an MCP server',
        description: 'Delete an MCP server of the library, which removes it from every agent.',
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/mcp-servers',
    async ({ params, membership }) => {
      if (!(await agentInTeam(params.agentId, membership.teamId, agentScopeOf(membership)))) {
        throw new HttpError(404, 'Agent not found');
      }
      return listAgentMcpServers(params.agentId, membership.teamId);
    },
    {
      params: agentParams,
      teamPermission: ['agent_tools', 'read'],
      response: { 200: McpServerListResponse, ...accessErrors },
      detail: { summary: "List an agent's MCP servers" },
    },
  )

  .put(
    '/teams/:teamId/ai-agents/:agentId/mcp-servers',
    async ({ params, membership, body }) => {
      if (!(await agentInTeam(params.agentId, membership.teamId, agentScopeOf(membership)))) {
        throw new HttpError(404, 'Agent not found');
      }
      await setAgentMcpServers(params.agentId, membership.teamId, body.mcpServerIds);
      return listAgentMcpServers(params.agentId, membership.teamId);
    },
    {
      params: agentParams,
      body: setAgentMcpServersBody,
      teamPermission: ['agent_tools', 'edit'],
      response: { 200: McpServerListResponse, ...commonErrors },
      detail: {
        summary: "Set an agent's MCP servers",
        description:
          'Replace the MCP servers of the library enabled on an agent. Send the full set: a ' +
          "server left out is removed. Ids that are not servers of the agent's team are ignored.",
      },
    },
  );
