import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import { maskForTeam } from '../credentials/env';
import {
  ClaimResponse,
  releaseQuery,
  reflectionBody,
  resultBody,
  ResultResponse,
  RunAckResponse,
  runClaimQuery,
  runParams,
  sessionBody,
} from './model';
import {
  claimRunnerRun,
  finishRun,
  heartbeatRun,
  recordReflection,
  releaseRun,
  reportRunSession,
} from './service';

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
      const ack = await heartbeatRun(agent.id, params.runId, query.claim);
      if (!ack) throw new HttpError(404, 'Run not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runParams,
      query: runClaimQuery,
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
      const answer = await finishRun(
        agent,
        params.runId,
        await maskForTeam(agent.teamId, body),
        query.claim,
      );
      if (!answer) throw new HttpError(404, 'Run not found');
      return answer;
    },
    {
      runnerAgent: true,
      params: runParams,
      query: runClaimQuery,
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
      if (!(await recordReflection(agent, params.runId, await maskForTeam(agent.teamId, body)))) {
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
  )

  .post(
    '/agent-runs/:runId/session',
    async ({ agent, params, query, body }) => {
      if (!(await reportRunSession(agent.id, params.runId, query.claim, body.sessionId)))
        throw new HttpError(404, 'Run not found');
      return noContent();
    },
    {
      runnerAgent: true,
      params: runParams,
      query: runClaimQuery,
      body: sessionBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Report the session of a run',
        description:
          'Save the coding agent session of a claimed run as soon as the runner reads it, ' +
          'so a claim after a crash resumes it instead of starting over. Best effort: the ' +
          'runner ignores a refusal and keeps working.',
      },
    },
  )

  .post(
    '/agent-runs/:runId/release',
    async ({ agent, params, query }) => {
      if (!(await releaseRun(agent.id, params.runId, query.claim)))
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
