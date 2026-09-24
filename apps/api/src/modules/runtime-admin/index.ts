import { Elysia } from 'elysia';
import { requireGod } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { errors } from '#shared/responses';
import { AgentRuntimeDefaultsResponse, agentRuntimeDefaultsBody } from './model';
import { getAgentRuntimeDefaults, setAgentRuntimeDefaults } from './settings';

// Administrator: the instance's defaults for every agent runtime.
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
  );
