import { Elysia, t } from 'elysia';
import { requireGod } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { errors } from '#shared/responses';
import { runnerAuth } from '#modules/agents/runner-auth';
import {
  EvalResult,
  LocalAiPolicy,
  LocalAiSettings,
  LocalAiStatus,
  ModelServer,
  ServerKeysResponse,
  evalBody,
  policyBody,
  serverBody,
  serverParams,
} from './model';
import {
  createServer,
  deleteServer,
  localAiSettings,
  localAiStatus,
  refreshServer,
  runEval,
  runtimeServerKeys,
  updatePolicy,
  updateServer,
} from './service';

// Local AI (docs/helena-decisions/local-ai-platform.md): the owner's model servers, the
// policy that sends background work there first, the evals that gate each kind of work, the
// status the "Lokale KI" card shows, and the keys a runner hands its agents. Owner only; the
// runners read the keys with their agent's own key.

export const localAiRoutes = new Elysia({
  name: 'local-ai',
  detail: { tags: ['Local AI'] },
})
  .use(authContext)
  .use(runnerAuth)

  .get(
    '/god/local-ai',
    ({ user }) => {
      requireGod(user);
      return localAiSettings();
    },
    {
      response: { 200: LocalAiSettings, ...errors(401, 403) },
      detail: {
        summary: 'Read the local AI settings',
        description:
          'The model servers with their models and status, the policy (master switch, units, ' +
          'task classes), each class with the model it would use and why it cannot be switched ' +
          'on yet, and the newest eval of each class and model.',
      },
    },
  )

  .get(
    '/god/local-ai/status',
    ({ user }) => {
      requireGod(user);
      return localAiStatus();
    },
    {
      response: { 200: LocalAiStatus, ...errors(401, 403) },
      detail: {
        summary: 'Read how busy local AI is',
        description:
          'The master switch, each unit (GPU, NPU, CPU) with its load and the models loaded on ' +
          'it, each server with its health, the task classes and the tokens that stayed local.',
      },
    },
  )

  .patch(
    '/god/local-ai/policy',
    ({ user, body }) => {
      requireGod(user);
      return updatePolicy(body);
    },
    {
      body: policyBody,
      response: { 200: LocalAiPolicy, ...errors(400, 401, 403, 409) },
      detail: {
        summary: 'Change the local AI policy',
        description:
          'The master switch, the units local work may use, a preset, and the mode and model ' +
          'of each task class. A class leaves `off` only when Helena sends its work to local AI ' +
          'and its model passed the class eval (409 otherwise). Switching the master off takes ' +
          'every local route out at once; nothing of it stays in the agents’ profiles.',
      },
    },
  )

  .post(
    '/god/local-ai/servers',
    ({ user, body }) => {
      requireGod(user);
      return createServer(body);
    },
    {
      body: serverBody,
      response: { 200: ModelServer, ...errors(400, 401, 403, 409) },
      detail: {
        summary: 'Add a local model server',
        description:
          'Lemonade on this machine by default (http://127.0.0.1:13305/api/v1, key from ' +
          '/etc/helena/local-ai.key). Helena reads its status and models at once.',
      },
    },
  )

  .patch(
    '/god/local-ai/servers/:id',
    ({ user, params, body }) => {
      requireGod(user);
      return updateServer(params.id, body);
    },
    {
      params: serverParams,
      body: serverBody,
      response: { 200: ModelServer, ...errors(400, 401, 403, 404) },
      detail: { summary: 'Change a local model server' },
    },
  )

  .delete(
    '/god/local-ai/servers/:id',
    async ({ user, params }) => {
      requireGod(user);
      if (!(await deleteServer(params.id))) throw new HttpError(404, 'No such server');
      return noContent();
    },
    {
      params: serverParams,
      response: { 204: t.Void(), ...errors(401, 403, 404) },
      detail: { summary: 'Remove a local model server' },
    },
  )

  .post(
    '/god/local-ai/servers/:id/check',
    ({ user, params }) => {
      requireGod(user);
      return refreshServer(params.id);
    },
    {
      params: serverParams,
      response: { 200: ModelServer, ...errors(401, 403, 404) },
      detail: { summary: "Read a server's status and models now" },
    },
  )

  .post(
    '/god/local-ai/evals',
    ({ user, body }) => {
      const owner = requireGod(user);
      return runEval({ ...body, userId: owner.id });
    },
    {
      body: evalBody,
      response: { 200: EvalResult, ...errors(400, 401, 403, 404) },
      detail: {
        summary: 'Run the eval of a task class on a local model',
        description:
          "A fixed set of cases with answers a program checks (the right tool and arguments, the text's " +
          'facts kept, the right label, the right document found). Takes up to a few minutes.',
      },
    },
  )

  // Read before each run and chat answer, like the MCP secrets.
  .get(
    '/agent-runtime/model-server-keys',
    async ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return { keys: await runtimeServerKeys() };
    },
    {
      runnerAgent: true,
      response: { 200: ServerKeysResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read the keys of the local model servers',
        description:
          "The keys of the local model servers the calling agent's profile names, by the " +
          'variable its runtime reads them from. Empty while local AI is off.',
      },
    },
  );
