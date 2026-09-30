import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { globalModelStatus } from '#modules/local-ai/global-model';
import { listClassViews } from '#modules/decisions/settings';
import { effectiveBrowserControl } from '#modules/browser-task/settings';
import { applyMatrix, modelMatrix, previewMatrix, type MatrixPatch } from './service';

const patchBody = t.Object({
  expectedRevision: t.Number({ minimum: 0 }),
  active: t.Optional(t.String()),
  projects: t.Optional(
    t.Array(t.Object({ projectId: t.Number(), schemaId: t.Nullable(t.String()) })),
  ),
  agents: t.Optional(
    t.Array(
      t.Object({
        agentId: t.Number(),
        role: t.Optional(t.String()),
        values: t.Record(t.String(), t.Any()),
      }),
    ),
  ),
  schema: t.Optional(t.Any()),
  removeSchema: t.Optional(t.String()),
  undo: t.Optional(t.Boolean()),
});

export const modelSchemaRoutes = new Elysia({
  name: 'model-schemas',
  detail: { tags: ['Model Schemas'] },
})
  .use(authContext)
  .get(
    '/god/model-schemas/matrix',
    async ({ user, query }) => {
      requireGod(user);
      const teamId = query.teamId ? Number(query.teamId) : undefined;
      const projectId = query.projectId ? Number(query.projectId) : undefined;
      const matrix = await modelMatrix(teamId, projectId);
      const [local, decisions, browser] = await Promise.all([
        globalModelStatus(),
        teamId ? listClassViews(teamId) : Promise.resolve([]),
        teamId && projectId
          ? effectiveBrowserControl({ teamId, projectId })
          : Promise.resolve(null),
      ]);
      return { ...matrix, local, decisions, browser };
    },
    { query: t.Object({ teamId: t.Optional(t.Numeric()), projectId: t.Optional(t.Numeric()) }) },
  )
  .post(
    '/god/model-schemas/preview',
    ({ user, body }) => {
      requireGod(user);
      return previewMatrix(body as MatrixPatch);
    },
    { body: patchBody },
  )
  .post(
    '/god/model-schemas/apply',
    ({ user, body }) => {
      requireGod(user);
      return applyMatrix(body as MatrixPatch);
    },
    { body: patchBody },
  );
