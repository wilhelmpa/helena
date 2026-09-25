import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import {
  RuntimeRequestClaimResponse,
  runtimeRequestAnswerBody,
  runtimeRequestParams,
} from './model';
import { answerRuntimeRequest, claimRuntimeRequest } from './service';
import { maskForTeam } from '../credentials/env';

// The runner's side of Helena's questions to an agent's runtime (sessions, transcripts,
// logs, health, curator, emergency stop), authenticated with the agent's own key.
export const agentRuntimeRequestRoutes = new Elysia({
  name: 'agent-runtime-requests',
  detail: { tags: ['Agent Runner'] },
})
  .use(runnerAuth)

  .post(
    '/agent-runtime/requests/claim',
    async ({ agent }) => ({ request: await claimRuntimeRequest(agent.id) }),
    {
      runnerAgent: true,
      response: { 200: RuntimeRequestClaimResponse, ...errors(401, 403) },
      detail: {
        summary: "Claim the next question for the agent's runtime",
        description:
          "Take the calling agent's oldest waiting runtime request, waiting up to about 25 " +
          'seconds for one. Answer it with the runtime adapter and report the answer.',
      },
    },
  )

  .post(
    '/agent-runtime/requests/:requestId/answer',
    async ({ agent, params, body }) => {
      // Transcripts and logs can hold a delivered secret long after its run: masked here,
      // with the team's values as they are now.
      const answer = await maskForTeam(agent.teamId, body);
      if (!(await answerRuntimeRequest(agent.id, params.requestId, answer))) {
        throw new HttpError(404, 'Request not found or already closed');
      }
      return noContent();
    },
    {
      runnerAgent: true,
      params: runtimeRequestParams,
      body: runtimeRequestAnswerBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Answer a runtime request',
        description:
          'Report what the runtime answered, or why it could not. The answer is refused once ' +
          'the person who asked stopped waiting.',
      },
    },
  );
