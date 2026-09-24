import { Elysia, t } from 'elysia';
import { requireGod, requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { teamParams } from '#modules/teams/model';
import {
  ModelAvailabilityResponse,
  ReplaceModelResponse,
  modelAvailabilityParams,
  replaceModelBody,
} from './model';
import { replaceModel } from './replace';
import { clearModelAvailability, listModelAvailability } from './service';

// Which models the agents' providers really serve: what runs and chat answers found out,
// read by the agent editor and the Administrator, cleared to try a model again, and the
// move of every agent off a refused model.

export const modelAvailabilityRoutes = new Elysia({
  name: 'model-availability',
  detail: { tags: ['Agents'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/model-availability',
    async ({ membership }) => ({ entries: await listModelAvailability(membership.teamId) }),
    {
      params: teamParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ModelAvailabilityResponse, ...commonErrors },
      detail: {
        summary: 'List what is known about the models the agents run on',
        description:
          "A model the provider refused for this account ('unavailable': left out of every " +
          "model picker, and a workflow stage on it fails at once) with the team's agents set " +
          "to it, and a model a run or chat answer confirmed ('works'). Read this before " +
          'choosing a model for an agent.',
        ...mcpTool('list_model_availability', undefined, 'read'),
      },
    },
  )

  .delete(
    '/teams/:teamId/model-availability/:entryId',
    async ({ params }) => {
      if (!(await clearModelAvailability(params.entryId))) {
        throw new HttpError(404, 'Nothing is recorded under this id');
      }
      return noContent();
    },
    {
      params: modelAvailabilityParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Try a model again',
        description:
          'Forgets what was recorded about the model: a refused model is offered again, and ' +
          'the next run on it tells anew whether the provider serves it.',
      },
    },
  )

  .post(
    '/teams/:teamId/model-availability/replace',
    async ({ membership, body, user }) =>
      replaceModel(membership.teamId, body.from, body.to, {
        dryRun: body.dryRun === true,
        actorUserId: requireUser(user).id,
      }),
    {
      params: teamParams,
      body: replaceModelBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: ReplaceModelResponse, ...commonErrors },
      detail: {
        summary: 'Move every agent off a model',
        description:
          "Sets every agent and template of the team that runs `from` to `to` (null: the " +
          "runtime's default), keeping an agent's reasoning effort where the new model " +
          'offers it. A template carries the change to the copies that follow it. Running it ' +
          'again changes nothing.',
      },
    },
  )

  .get(
    '/god/model-availability',
    async ({ user }) => {
      requireGod(user);
      return { entries: await listModelAvailability() };
    },
    {
      response: { 200: ModelAvailabilityResponse, ...errors(401, 403) },
      detail: {
        summary: 'List what is known about the models, for the whole instance',
        description: 'Every finding with the agents of every team set to a refused model.',
      },
    },
  );
