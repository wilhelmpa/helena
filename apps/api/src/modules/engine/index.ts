import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { usablePipeline } from '#modules/pipelines/service';
import { registerBuiltins } from './builtin/index';
import { createHook, deleteHook, getHook, receiveHook } from './hooks';
import { listStepTypes, listTriggerTypes } from './registry';
import { projectSigningSecret, rotateProjectSigningSecret } from './secrets';
import { defaultTimezone } from './settings';

// The routes of the Helena engine: the inbound webhooks of workflows (public, signed),
// and what the builder needs to know about the engine (the registered step and trigger
// types, a workflow's hook, the project's signing secret for webhook steps).

export const engineHookRoutes = new Elysia({ name: 'engine-hooks' }).post(
  '/hooks/workflows/:hookId',
  async ({ params, request, set }) => {
    const run = await receiveHook(params.hookId, request);
    set.status = 202;
    return run;
  },
  {
    params: t.Object({ hookId: t.String({ pattern: '^hk_[A-Za-z0-9_-]{8,64}$' }) }),
    parse: 'none',
    response: {
      202: t.Object({ runId: t.String() }),
      ...errors(400, 401, 404, 409, 413),
    },
    detail: {
      tags: ['Workflow builder'],
      summary: 'Start a workflow from a webhook',
      description:
        'Starts the workflow whose hook this is on a new task. Sign the request per Standard ' +
        'Webhooks (webhook-id, webhook-timestamp, webhook-signature) with the hook secret, or ' +
        'send the secret as a bearer token. The same webhook-id starts one run only. An ' +
        'optional JSON body may carry `title` and `description` for the task.',
    },
  },
);

const hookParams = t.Object({ projectKey: t.String(), pipelineId: t.Numeric() });

const HookResponse = t.Object({
  id: t.String(),
  url: t.String({ description: 'The path of the hook on the api.' }),
  createdAt: t.String(),
  lastUsedAt: t.Nullable(t.String()),
});

export const engineRoutes = new Elysia({
  name: 'engine',
  detail: { tags: ['Workflow builder'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/workflow-engine/types',
    () => {
      registerBuiltins();
      return {
        steps: listStepTypes().map((type) => ({
          type: type.type,
          builder: type.ui.builder,
          icon: type.ui.icon ?? null,
          branching: type.branching === true,
        })),
        triggers: listTriggerTypes().map((type) => ({
          type: type.type,
          events: type.events ?? [],
          scheduled: type.schedule !== undefined,
        })),
      };
    },
    {
      response: {
        200: t.Object({
          steps: t.Array(
            t.Object({
              type: t.String(),
              builder: t.Boolean(),
              icon: t.Nullable(t.String()),
              branching: t.Boolean(),
            }),
          ),
          triggers: t.Array(
            t.Object({ type: t.String(), events: t.Array(t.String()), scheduled: t.Boolean() }),
          ),
        }),
        ...errors(401),
      },
      detail: {
        summary: 'List the step and trigger types',
        description:
          'The step and trigger types the engine has registered: the built-in ones and those ' +
          'plugins add.',
      },
    },
  )
  .get('/workflow-engine/settings', async () => ({ defaultTimezone: await defaultTimezone() }), {
    response: { 200: t.Object({ defaultTimezone: t.String() }), ...errors(401) },
    detail: {
      summary: 'Read the default time zone of schedules',
      description:
        'The time zone a routine, a workflow schedule or a wait step uses when it names none.',
    },
  })
  .get(
    '/projects/:projectKey/pipelines/:pipelineId/hook',
    async ({ project, params }) => {
      await usablePipeline(project, params.pipelineId);
      return getHook(project.id, params.pipelineId);
    },
    {
      permission: ['actions', 'read'],
      params: hookParams,
      response: { 200: t.Nullable(HookResponse), ...accessErrors },
      detail: {
        summary: 'Get the webhook of a workflow',
        description: 'The hook a sender posts to, without its secret; null when there is none.',
      },
    },
  )
  .post(
    '/projects/:projectKey/pipelines/:pipelineId/hook',
    async ({ project, params, user }) => {
      await usablePipeline(project, params.pipelineId);
      return createHook(project.id, params.pipelineId, requireUser(user).id);
    },
    {
      permission: ['actions', 'edit'],
      params: hookParams,
      response: {
        200: t.Object({ id: t.String(), url: t.String(), secret: t.String() }),
        ...commonErrors,
        ...errors(409),
      },
      detail: {
        summary: 'Create or renew the webhook of a workflow',
        description:
          'Creates the hook of a workflow with a webhook trigger, or gives it a new secret. The ' +
          'secret is answered only now.',
      },
    },
  )
  .delete(
    '/projects/:projectKey/pipelines/:pipelineId/hook',
    async ({ project, params }) => {
      await usablePipeline(project, params.pipelineId);
      await deleteHook(project.id, params.pipelineId);
      return noContent();
    },
    {
      permission: ['actions', 'edit'],
      params: hookParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete the webhook of a workflow', description: 'Senders get 404.' },
    },
  )
  .get(
    '/projects/:projectKey/workflow-signing-secret',
    async ({ project }) => ({ secret: await projectSigningSecret(project.id) }),
    {
      permission: ['actions', 'edit'],
      response: { 200: t.Object({ secret: t.String() }), ...accessErrors },
      detail: {
        summary: "Get the project's webhook signing secret",
        description:
          'The Standard Webhooks secret the webhook steps of the project sign their requests ' +
          'with, for the receiver to verify them.',
      },
    },
  )
  .post(
    '/projects/:projectKey/workflow-signing-secret',
    async ({ project }) => ({ secret: await rotateProjectSigningSecret(project.id) }),
    {
      permission: ['actions', 'edit'],
      response: { 200: t.Object({ secret: t.String() }), ...commonErrors },
      detail: {
        summary: "Renew the project's webhook signing secret",
        description: 'Webhook steps sign with the new secret from now on.',
      },
    },
  );
