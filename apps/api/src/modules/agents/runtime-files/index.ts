import { Elysia, t } from 'elysia';

import { mcpTool } from '#mcp/generate';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors } from '#shared/responses';
import { agentScopeOf } from '../core/service';
import {
  AgentRuntimeFileListResponse,
  agentParams,
  runtimeFileQuery,
  upsertRuntimeFileBody,
} from './model';
import { deleteAgentRuntimeFile, listAgentRuntimeFiles, upsertAgentRuntimeFile } from './service';

export const agentRuntimeFileRoutes = new Elysia({
  name: 'agent-runtime-files',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime-files',
    async ({ params, membership }) => {
      const files = await listAgentRuntimeFiles(
        params.agentId,
        membership.teamId,
        agentScopeOf(membership),
      );
      if (!files) throw new HttpError(404, 'Agent not found');
      return files;
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: AgentRuntimeFileListResponse, ...commonErrors },
      detail: {
        summary: "List an external agent's managed Markdown files",
        description:
          'List non-secret instruction and memory Markdown stored in the agent runtime policy.',
        ...mcpTool('list_agent_runtime_files', { readOnlyHint: true }),
      },
    },
  )
  .put(
    '/teams/:teamId/ai-agents/:agentId/runtime-files',
    async ({ params, membership, body }) => {
      const files = await upsertAgentRuntimeFile(
        params.agentId,
        membership.teamId,
        agentScopeOf(membership),
        body.path,
        body.content,
      );
      if (!files) throw new HttpError(404, 'Agent not found');
      return files;
    },
    {
      params: agentParams,
      body: upsertRuntimeFileBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: AgentRuntimeFileListResponse, ...commonErrors },
      detail: {
        summary: "Create or update an external agent's managed Markdown file",
        description:
          'Upsert AGENTS.md, SOUL.md, MEMORY.md, or a Markdown file below instructions/ or memory/.',
        ...mcpTool('upsert_agent_runtime_file'),
      },
    },
  )
  .delete(
    '/teams/:teamId/ai-agents/:agentId/runtime-files',
    async ({ params, membership, query }) => {
      const files = await deleteAgentRuntimeFile(
        params.agentId,
        membership.teamId,
        agentScopeOf(membership),
        query.path,
      );
      if (!files) throw new HttpError(404, 'Agent not found');
      return noContent();
    },
    {
      params: agentParams,
      query: runtimeFileQuery,
      teamPermission: ['ai_agents', 'edit'],
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: "Delete an external agent's managed Markdown file",
        ...mcpTool('delete_agent_runtime_file', { destructiveHint: true }),
      },
    },
  );
