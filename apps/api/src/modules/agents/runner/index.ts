import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import {
  ClaimResponse,
  reflectionBody,
  resultBody,
  ResultResponse,
  RunAckResponse,
  runParams,
} from './model';
import { claimRunnerRun, finishRun, heartbeatRun, recordReflection } from './service';

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
    async ({ agent, params }) => {
      const ack = await heartbeatRun(agent.id, params.runId);
      if (!ack) throw new HttpError(404, 'Run not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runParams,
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
    async ({ agent, params, body }) => {
      const answer = await finishRun(agent, params.runId, body);
      if (!answer) throw new HttpError(404, 'Run not found');
      return answer;
    },
    {
      runnerAgent: true,
      params: runParams,
      body: resultBody,
      response: { 200: ResultResponse, ...commonErrors },
      detail: {
        summary: 'Report a run result',
        description:
          'Finish a claimed run as success or failed. A failure is not retried. The answer ' +
          "names a reflection to run in the run's session when the agent learns and the run " +
          'is worth one.',
      },
    },
  )

  .post(
    '/agent-runs/:runId/reflection',
    async ({ agent, params, body }) => {
      if (!(await recordReflection(agent, params.runId, body))) {
        throw new HttpError(404, 'No reflection of this run is waiting');
      }
      return noContent();
    },
    {
      runnerAgent: true,
      params: runParams,
      body: reflectionBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Report a reflection',
        description:
          'Report the reflection the run result asked for: how it went, what the agent saved ' +
          "and the tokens it used, which are added to the run's.",
      },
    },
  );
