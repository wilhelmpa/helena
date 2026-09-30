import { Elysia } from 'elysia';
import { errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import { agentMcpSecrets } from '../mcp-servers/service';
import { RuntimeLoginResponse, workRefQuery } from '../credentials/model';
import { claimedWork, recordMcpSecretDelivery, workRefOf } from '../credentials/delivery';
import { runtimeLoginOf } from '../credentials/runtime-login';
import { maskForTeam } from '../credentials/env';
import {
  McpSecretsResponse,
  RuntimePolicySnapshotResponse,
  RuntimeStateBody,
  RuntimeStateResponse,
} from './model';
import { reportRuntimeState, runtimePolicySnapshot } from './service';
import { modelMatrix } from '#modules/model-schemas/service';

// Runtime-neutral control-plane adapter contract. A runner authenticates as exactly
// one external agent, reads that agent's non-secret desired policy, applies what its
// runtime supports, then reports adapter/capability/status without returning secrets.
// The values of the secrets its MCP servers reference come from a route of their own;
// named with the run or chat answer they are for, a read is recorded in the audit log.
export const agentRuntimePolicyRoutes = new Elysia({
  name: 'agent-runtime-policy',
  detail: { tags: ['Agent Runtime'] },
})
  .use(runnerAuth)
  .get('/agent-runtime/model-matrix', ({ agent }) => modelMatrix(agent.teamId), {
    runnerAgent: true,
    detail: { summary: 'Read effective model settings and their sources for this team' },
  })
  .get('/agent-runtime/policy', ({ agent }) => runtimePolicySnapshot(agent), {
    runnerAgent: true,
    response: { 200: RuntimePolicySnapshotResponse, ...errors(401, 403) },
    detail: { summary: "Read the calling agent's desired runtime policy" },
  })
  // Read before each run and chat answer, so a changed secret needs no new revision.
  .get(
    '/agent-runtime/mcp-secrets',
    async ({ agent, query, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const ref = workRefOf(query);
      const work = ref && (await claimedWork(agent.id, ref));
      const secrets = await agentMcpSecrets(agent.id, agent.teamId);
      if (work) await recordMcpSecretDelivery(agent, work, Object.keys(secrets).map(Number));
      return { secrets };
    },
    {
      runnerAgent: true,
      query: workRefQuery,
      response: { 200: McpSecretsResponse, ...errors(400, 401, 403, 404) },
      detail: {
        summary: "Read the secrets of the calling agent's MCP servers",
        description:
          "The values of the secrets the calling agent's MCP servers reference, by secret id.",
      },
    },
  )
  // Read before each run and chat answer of a Claude Code or Codex agent; without a run or
  // chat answer, only whether a login is granted (for its health), never the value.
  .get(
    '/agent-runtime/runtime-login',
    async ({ agent, query, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return { login: await runtimeLoginOf(agent, workRefOf(query)) };
    },
    {
      runnerAgent: true,
      query: workRefQuery,
      response: { 200: RuntimeLoginResponse, ...errors(400, 401, 403, 404) },
      detail: {
        summary: "Read the login of the calling agent's Claude Code or Codex runtime",
        description:
          "The newest runtime login (Credentials page, kind runtime_login) of the agent's " +
          'runtime granted to it. Named with a run or chat answer the agent holds, the ' +
          'answer carries the value and the delivery is recorded in the audit log.',
      },
    },
  )
  // What the agent learned (memory proposals, skills) is text it wrote: a delivered secret
  // in it is masked before Helena stores or shows it.
  .post(
    '/agent-runtime/status',
    async ({ agent, body }) => reportRuntimeState(agent.id, await maskForTeam(agent.teamId, body)),
    {
      runnerAgent: true,
      body: RuntimeStateBody,
      response: { 200: RuntimeStateResponse, ...errors(401, 403, 413) },
      detail: { summary: "Report the calling agent's runtime adapter status" },
    },
  );
