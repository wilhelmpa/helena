import { withModelAdmission, assertModelIdle } from './maintenance-state';
import {
  beginGlobalModel,
  bulkLocalDefault,
  globalModelStatus,
  previewGlobalModel,
  resumeGlobalModel,
} from './global-model';
import { globalModelBody, globalModelResumeBody, bulkLocalDefaultBody } from './model';
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
  JudgeView,
  ServerKeysResponse,
  evalBody,
  judgeBody,
  evalParams,
  modelOptionsBody,
  policyBody,
  serverBody,
  serverParams,
} from './model';
import {
  createServer,
  deleteServer,
  evalById,
  localAiSettings,
  localAiStatus,
  refreshServer,
  runtimeServerKeys,
  startEval,
  updatePolicy,
  updateServer,
  updateModelOptions,
} from './service';
import { judgeView, writeJudge } from './judge';

async function configureModel<T>(change: () => Promise<T>): Promise<T> {
  const result = await withModelAdmission(async () => {
    await assertModelIdle();
    return change();
  });
  if (result === null) throw new HttpError(409, 'Model maintenance is pending');
  return result;
}

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

  .get('/god/local-ai/default', () => globalModelStatus(), {
    beforeHandle: ({ user }) => {
      requireGod(user);
    },
    detail: { summary: 'Read the global local model and durable maintenance progress' },
  })
  .post(
    '/god/local-ai/default/preview',
    ({ body }) => previewGlobalModel(body.model, body.profile, body.npuModel),
    {
      beforeHandle: ({ user }) => {
        requireGod(user);
      },
      body: globalModelBody,
      detail: { summary: 'Preview affected agents, classes and the 72 GB weight lock' },
    },
  )
  .post(
    '/god/local-ai/default/apply',
    ({ body }) => beginGlobalModel(body.model, body.profile, body.npuModel),
    {
      beforeHandle: ({ user }) => {
        requireGod(user);
      },
      body: globalModelBody,
      detail: { summary: 'Begin a recoverable local model switch' },
    },
  )
  .post('/god/local-ai/default/resume', ({ body }) => resumeGlobalModel(body.rollback), {
    beforeHandle: ({ user }) => {
      requireGod(user);
    },
    body: globalModelResumeBody,
    detail: { summary: 'Resume or roll back the pending model switch' },
  })
  .post('/god/local-ai/default/agents', ({ body }) => bulkLocalDefault(body.ids, body.apply), {
    beforeHandle: ({ user }) => {
      requireGod(user);
    },
    body: bulkLocalDefaultBody,
    detail: { summary: 'Preview or apply local default to selected agents' },
  })

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
      return configureModel(() => updatePolicy(body));
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
      return configureModel(() => createServer(body));
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
      return configureModel(() => updateServer(params.id, body));
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
      if (!(await configureModel(() => deleteServer(params.id))))
        throw new HttpError(404, 'No such server');
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

  .put(
    '/god/local-ai/servers/:id/models/:model/options',
    ({ user, params, body }) => {
      requireGod(user);
      return configureModel(() => updateModelOptions(params.id, params.model, body));
    },
    {
      params: t.Object({ id: t.Numeric(), model: t.String({ maxLength: 300 }) }),
      body: modelOptionsBody,
      response: { 200: modelOptionsBody, ...errors(400, 401, 403, 404) },
      detail: { summary: 'Save Lemonade start options for a model' },
    },
  )

  .post(
    '/god/local-ai/evals',
    ({ user, body, set }) => {
      const owner = requireGod(user);
      set.status = 202;
      return startEval({ ...body, userId: owner.id });
    },
    {
      body: evalBody,
      response: { 202: EvalResult, ...errors(400, 401, 403, 404, 409) },
      detail: {
        summary: 'Start the eval of a task class on a local model',
        description:
          "A fixed set of cases with answers a program checks (the right tool and arguments, the text's " +
          'facts kept, the right label, the right document found). It runs in the background ' +
          '(minutes on a local model): the answer is the eval, `running`; read it again with ' +
          'GET /god/local-ai/evals/{id} until it is `done`. 409 while the same class runs on the ' +
          'same model.',
      },
    },
  )

  .get(
    '/god/local-ai/evals/:id',
    async ({ user, params }) => {
      requireGod(user);
      const found = await evalById(params.id);
      if (!found) throw new HttpError(404, 'No such eval');
      return found;
    },
    {
      params: evalParams,
      response: { 200: EvalResult, ...errors(401, 403, 404) },
      detail: {
        summary: 'Read an eval',
        description: 'Its status, and once it is `done` its score, latency and failed cases.',
      },
    },
  )

  .get(
    '/god/local-ai/judge',
    async ({ user }) => {
      requireGod(user);
      return judgeView();
    },
    {
      response: { 200: JudgeView, ...errors(401, 403) },
      detail: {
        summary: 'Read the judge of the local AI evals',
        description:
          'The model that scores the evals a program cannot check (Deutsch-Texte): a text-only ' +
          'run of a Hermes agent on a subscription model (the default, gpt-6-sol), an ' +
          'OpenAI-compatible endpoint with a stored key, or off. Never the key itself.',
      },
    },
  )

  .put(
    '/god/local-ai/judge',
    async ({ user, body }) => {
      requireGod(user);
      await writeJudge(body);
      return judgeView();
    },
    {
      body: judgeBody,
      response: { 200: JudgeView, ...errors(400, 401, 403) },
      detail: { summary: 'Set the judge of the local AI evals' },
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
