import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import {
  ClaimResponse,
  releaseQuery,
  resultBody,
  RunAckResponse,
  runAttemptQuery,
  runParams,
} from './model';
import { claimRunnerRun, finishRun, heartbeatRun, releaseRun } from './service';

// The queue an external agent's runner drains, authenticated with the agent's own
// API key.
export const agentRunnerRoutes = new Elysia({
  name: 'agent-runner',
  detail: { tags: ['Agent Runner'] },
})
  .use(runnerAuth)

  .post('/agent-runs/claim', async ({ agent }) => ({ run: await claimRunnerRun(agent) }), {
    runnerAgent: true,
    response: { 200: ClaimResponse, ...errors(401, 403) },
    detail: {
      summary: 'Claim the next run',
      description:
        "Take the calling agent's next queued run, or run: null when it has none. It is " +
        'leased: report a result or send heartbeats, otherwise it is handed out again.',
    },
  })

  .post(
    '/agent-runs/:runId/heartbeat',
    async ({ agent, params, query }) => {
      const ack = await heartbeatRun(agent.id, params.runId, query.attempt);
      if (!ack) throw new HttpError(404, 'Run not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runParams,
      query: runAttemptQuery,
      response: { 200: RunAckResponse, ...commonErrors },
      detail: {
        summary: 'Extend a run lease',
        description:
          'Keep a claimed run leased while the runner is still working on it. Answers ' +
          '`canceled` when the run was canceled: kill the command and report nothing for it.',
      },
    },
  )

  .post(
    '/agent-runs/:runId/result',
    async ({ agent, params, query, body }) => {
      const ok = await finishRun(agent, params.runId, body, query.attempt);
      if (!ok) throw new HttpError(404, 'Run not found');
      return noContent();
    },
    {
      runnerAgent: true,
      params: runParams,
      query: runAttemptQuery,
      body: resultBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Report a run result',
        description: 'Finish a claimed run as success or failed. A failure is not retried.',
      },
    },
  )

  .post(
    '/agent-runs/:runId/release',
    async ({ agent, params, query }) => {
      if (!(await releaseRun(agent.id, params.runId, query.attempt)))
        throw new HttpError(404, 'Run not found');
      return noContent();
    },
    {
      runnerAgent: true,
      params: runParams,
      query: releaseQuery,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Hand a claimed run back',
        description:
          'Put a claimed run back in the queue at once, without counting the attempt, for a ' +
          'runner that stops while it executes the run.',
      },
    },
  );
