import { Elysia, t } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { agentInTeam, agentScopeOf } from '../core/service';
import { runnerAuth } from '../runner-auth';
import { agentParams, RuntimeSyncResponse, runnerHealthBody } from './model';
import { queueProfileRewrite, recordRunnerHealth, runtimeSyncOf } from './service';

// Whether an agent's runtime runs exactly on its settings in Helena ("Profil synchron" or
// the drift its runner found), and "Neu schreiben", which has the runner write the whole
// profile again. The runner's wrapper reports here when the runner cannot start at all.
export const agentRuntimeSyncRoutes = new Elysia({
  name: 'agent-runtime-sync',
  detail: { tags: ['Agent Runtime'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime-sync',
    async ({ params, membership }) => {
      if (!(await agentInTeam(params.agentId, membership.teamId, agentScopeOf(membership)))) {
        throw new HttpError(404, 'Agent not found');
      }
      return runtimeSyncOf(params.agentId, membership.teamId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RuntimeSyncResponse, ...accessErrors, ...errors(404) },
      detail: {
        summary: "Read whether an agent's runtime is in sync",
        description:
          "Compares the revision of the agent's settings with the one its runner applied, " +
          'and names the drift the runner found when it read the runtime profile back.',
      },
    },
  )
  .post(
    '/teams/:teamId/ai-agents/:agentId/runtime-sync/rewrite',
    async ({ params, membership }) => {
      if (!(await agentInTeam(params.agentId, membership.teamId, agentScopeOf(membership)))) {
        throw new HttpError(404, 'Agent not found');
      }
      return queueProfileRewrite(params.agentId, membership.teamId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: RuntimeSyncResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: "Rewrite an agent's runtime profile",
        description:
          "Has the agent's runner write its whole runtime profile again with its next sync " +
          'and read it back at once ("Neu schreiben").',
      },
    },
  );

export const runnerHealthRoutes = new Elysia({
  name: 'agent-runner-health',
  detail: { tags: ['Agent Runtime'] },
})
  .use(runnerAuth)
  .post(
    '/agent-runtime/runner-health',
    async ({ body }) => {
      await recordRunnerHealth(body.error);
      return noContent();
    },
    {
      runnerAgent: true,
      body: runnerHealthBody,
      response: { 204: t.Void(), ...errors(401, 403) },
      detail: {
        summary: "Report whether the calling agent's runner could start",
        description:
          'Sent by the runner when it starts (error null) and by its service wrapper when ' +
          'it cannot start it, so the health overview names the reason instead of only ' +
          'showing the agents offline.',
      },
    },
  );
