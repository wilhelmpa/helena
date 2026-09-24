import { Elysia } from 'elysia';
import { requireGod } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import {
  AgentRuntimeDefaultsResponse,
  HermesUpdateRequestResponse,
  HermesUpdateStateResponse,
  agentRuntimeDefaultsBody,
} from './model';
import { getAgentRuntimeDefaults, setAgentRuntimeDefaults } from './settings';
import { checkHermesUpdate, hermesUpdateState, requestHermesUpdate } from './hermes-update';

// Administrator: the instance's defaults for every agent runtime, and updates of Hermes.
export const runtimeAdminRoutes = new Elysia({
  name: 'runtime-admin',
  detail: { tags: ['Agent Runtime'] },
})
  .use(authContext)

  .get(
    '/god/agent-runtime-settings',
    ({ user }) => {
      requireGod(user);
      return getAgentRuntimeDefaults();
    },
    {
      response: { 200: AgentRuntimeDefaultsResponse, ...errors(401, 403) },
      detail: { summary: "Read the instance's agent runtime defaults" },
    },
  )

  .put(
    '/god/agent-runtime-settings',
    ({ user, body }) => {
      requireGod(user);
      return setAgentRuntimeDefaults(body);
    },
    {
      body: agentRuntimeDefaultsBody,
      response: { 200: AgentRuntimeDefaultsResponse, ...errors(400, 401, 403) },
      detail: {
        summary: "Change the instance's agent runtime defaults",
        description:
          'The fallback models every agent that names none of its own falls back to, in order.',
      },
    },
  )

  .get('/god/hermes-update', async ({ user }) => hermesUpdateState(requireGod(user).id), {
    response: { 200: HermesUpdateStateResponse, ...errors(401, 403) },
    detail: {
      summary: 'Read the state of Hermes updates',
      description:
        'The last check (installed and newest version, the upstream commits between them, ' +
        'the local commits carried over) and the latest update proposal with its outcome.',
    },
  })

  .post(
    '/god/hermes-update/check',
    async ({ user }) => {
      await checkHermesUpdate(requireGod(user).id);
      return hermesUpdateState(requireGod(user).id);
    },
    {
      response: { 200: HermesUpdateStateResponse, ...errors(401, 403, 502, 503, 504) },
      detail: { summary: 'Check for a Hermes update' },
    },
  )

  .post(
    '/god/hermes-update/request',
    async ({ user, set }) => {
      requireGod(user);
      set.status = 201;
      return { proposalId: await requestHermesUpdate() };
    },
    {
      response: { 201: HermesUpdateRequestResponse, ...errors(401, 403, 409) },
      detail: {
        summary: 'Request a Hermes update',
        description:
          'Raises a proposal for the approvals page to update to the newest version the last ' +
          'check found. Approving it starts the update, which rolls back on any failure.',
      },
    },
  );
