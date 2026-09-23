import { Elysia } from 'elysia';
import { errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import { agentMcpSecrets } from '../mcp-servers/service';
import {
  McpSecretsResponse,
  RuntimePolicySnapshotResponse,
  RuntimeStateBody,
  RuntimeStateResponse,
} from './model';
import { reportRuntimeState, runtimePolicySnapshot } from './service';

// Runtime-neutral control-plane adapter contract. A runner authenticates as exactly
// one external agent, reads that agent's non-secret desired policy, applies what its
// runtime supports, then reports adapter/capability/status without returning secrets.
// The values of the secrets its MCP servers reference come from a route of their own.
export const agentRuntimePolicyRoutes = new Elysia({
  name: 'agent-runtime-policy',
  detail: { tags: ['Agent Runtime'] },
})
  .use(runnerAuth)
  .get('/agent-runtime/policy', ({ agent }) => runtimePolicySnapshot(agent), {
    runnerAgent: true,
    response: { 200: RuntimePolicySnapshotResponse, ...errors(401, 403) },
    detail: { summary: "Read the calling agent's desired runtime policy" },
  })
  // Read before each run and chat answer, so a changed secret needs no new revision.
  .get(
    '/agent-runtime/mcp-secrets',
    async ({ agent, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return { secrets: await agentMcpSecrets(agent.id, agent.teamId) };
    },
    {
      runnerAgent: true,
      response: { 200: McpSecretsResponse, ...errors(401, 403) },
      detail: {
        summary: "Read the secrets of the calling agent's MCP servers",
        description:
          "The values of the secrets the calling agent's MCP servers reference, by secret id.",
      },
    },
  )
  .post('/agent-runtime/status', ({ agent, body }) => reportRuntimeState(agent.id, body), {
    runnerAgent: true,
    body: RuntimeStateBody,
    response: { 200: RuntimeStateResponse, ...errors(401, 403) },
    detail: { summary: "Report the calling agent's runtime adapter status" },
  });
