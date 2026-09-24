import { Elysia, t } from 'elysia';
import { requireGod, requireUser, type AuthUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { isAgentUser } from '#modules/agents/core/service';
import { runnerAuth } from '#modules/agents/runner-auth';
import {
  ProviderLimitSettings,
  ProviderLimitsResponse,
  providerLimitParams,
  providerLimitSettingsBody,
  runnerLimitsBody,
} from './model';
import {
  deleteProviderLimit,
  getLimitSettings,
  listProviderLimits,
  recordLimitSnapshots,
  refreshProviderLimits,
  setLimitSettings,
} from './service';

// The plan limits of the subscriptions Helena's agents and its owner work on (ChatGPT/Codex,
// Claude): the Administrator reads and refreshes them, an agent reads them to plan its work
// (MCP tool get_provider_limits), and a runner reports what its runtime's output showed.

// The Administrator, or an agent's own key: the numbers belong to the instance's own
// subscriptions, not to a team.
async function requireLimitsReader(user: AuthUser | undefined | null): Promise<void> {
  const current = requireUser(user);
  if (current.role === 'god') return;
  if (await isAgentUser(current.id)) return;
  throw new HttpError(403, 'Only the Administrator and agents read the plan limits');
}

export const providerLimitRoutes = new Elysia({
  name: 'provider-limits',
  detail: { tags: ['Provider Limits'] },
})
  .use(authContext)
  .use(runnerAuth)

  .get(
    '/provider-limits',
    async ({ user }) => {
      await requireLimitsReader(user);
      return listProviderLimits();
    },
    {
      response: { 200: ProviderLimitsResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read how much of the plan limits is used',
        description:
          'One entry per provider account (the ChatGPT plan behind Codex and Hermes, the Claude ' +
          'plan behind Claude Code): every window (the rolling session of about five hours, the ' +
          'week, model-specific weeks) with the share used, when it resets and its state ' +
          '(ok, near, limited), and the agents working on the account with the tokens they ' +
          'spent in the window. Read this before starting large work: while an account is ' +
          '`limited`, its agents cannot answer until `nextResetAt`.',
        ...mcpTool('get_provider_limits', undefined, 'read'),
      },
    },
  )

  .post(
    '/provider-limits/refresh',
    async ({ user }) => {
      requireGod(user);
      return refreshProviderLimits();
    },
    {
      response: { 200: ProviderLimitsResponse, ...errors(401, 403) },
      detail: {
        summary: 'Ask for the plan limits now',
        description:
          'Every runner that can reads the limits of its runtimes’ logins again (at most ' +
          'once a minute per login); waits for them up to 30 seconds.',
      },
    },
  )

  .get(
    '/provider-limits/settings',
    ({ user }) => {
      requireGod(user);
      return getLimitSettings();
    },
    {
      response: { 200: ProviderLimitSettings, ...errors(401, 403) },
      detail: { summary: 'Read how often the plan limits are read' },
    },
  )

  .patch(
    '/provider-limits/settings',
    ({ user, body }) => {
      requireGod(user);
      return setLimitSettings(body);
    },
    {
      body: providerLimitSettingsBody,
      response: { 200: ProviderLimitSettings, ...errors(400, 401, 403) },
      detail: {
        summary: 'Change how often the plan limits are read',
        description:
          'The interval Helena asks the runners in (5–60 minutes), whether it does on its own, ' +
          'and the share from which a window counts as close to its limit.',
      },
    },
  )

  .delete(
    '/provider-limits/:limitId',
    async ({ user, params }) => {
      requireGod(user);
      await deleteProviderLimit(params.limitId);
      return noContent();
    },
    {
      params: providerLimitParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Forget a plan account',
        description:
          'Removes an account nobody works on any more; it comes back with the next reading.',
      },
    },
  )

  .post(
    '/agent-runtime/limits',
    async ({ agent, body }) => {
      await recordLimitSnapshots(agent.id, body.snapshots);
      return noContent();
    },
    {
      runnerAgent: true,
      body: runnerLimitsBody,
      response: { 204: t.Void(), ...errors(400, 401, 403) },
      detail: {
        tags: ['Agent Runner'],
        summary: "Report the plan limits a run's output showed",
        description:
          'Numbers only, in the @helena/sdk UsageLimitSnapshot shape; every field is checked ' +
          'and anything else is dropped.',
      },
    },
  );
