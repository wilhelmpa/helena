import { Elysia } from 'elysia';
import { errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import { RuntimePolicySnapshotResponse, RuntimeStateBody, RuntimeStateResponse } from './model';
import { reportRuntimeState, runtimePolicySnapshot } from './service';

// Runtime-neutral control-plane adapter contract. A runner authenticates as exactly
// one external agent, reads that agent's non-secret desired policy, applies what its
// runtime supports, then reports adapter/capability/status without returning secrets.
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
  .post('/agent-runtime/status', ({ agent, body }) => reportRuntimeState(agent.id, body), {
    runnerAgent: true,
    body: RuntimeStateBody,
    response: { 200: RuntimeStateResponse, ...errors(401, 403) },
    detail: { summary: "Report the calling agent's runtime adapter status" },
  });
