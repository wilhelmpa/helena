import { Elysia, t } from 'elysia';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { globalModelStatus } from '#modules/local-ai/global-model';
import { listClassViews } from '#modules/decisions/settings';
import { effectiveBrowserControl } from '#modules/browser-task/settings';
import { followLocalProfile } from './profile-follow';
import {
  applyMatrix,
  modelMatrix,
  previewMatrix,
  createSchema,
  updateSchema,
  updateSchemaRole,
  removeSchema,
  removeSchemaRole,
  listSchemas,
  getSchema,
  schemaAudit,
  type MatrixPatch,
} from './service';
import {
  createBody,
  updateBody,
  revisionBody,
  schemaParams,
  roleBody,
  roleParams,
  patchBody,
  followProfileBody,
  schemaResponse,
  listResponse,
  matrixResponse,
  previewResponse,
} from './model';

const failures = errors(400, 401, 403, 404, 409);

export const modelSchemaRoutes = new Elysia({
  name: 'model-schemas',
  detail: { tags: ['Model Schemas'] },
})
  .use(authContext)
  .macro({
    modelSchemaAdmin: {
      resolve: async ({ user }) => {
        const caller = requireUser(user);
        if (caller.role !== 'god') {
          const [agent] = await db
            .select({ role: aiAgent.agentRole })
            .from(aiAgent)
            .where(eq(aiAgent.userId, caller.id));
          if (agent?.role !== 'home') throw new HttpError(403, 'Model schemas are owner/Home-only');
        }
        return { schemaActorId: caller.id };
      },
    },
  })
  .get('/god/model-schemas', () => listSchemas(), {
    modelSchemaAdmin: true,
    response: { 200: listResponse, ...failures },
    detail: {
      summary: 'List model schemas and available models',
      description:
        'Returns matrix revision, active schema, built-ins with selectable local profiles, editable custom schemas, roles, columns and the runtime-specific model catalog and runtime selectability (command/webhook have no model catalog). Example: {}.',
      ...mcpTool('list_model_schemas'),
    },
  })
  .get('/god/model-schemas/audit', ({ query }) => schemaAudit(query.limit ?? 50), {
    modelSchemaAdmin: true,
    query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })) }),
    response: { 200: t.Any(), ...failures },
    detail: {
      summary: 'Read model schema audit entries',
      description:
        'Returns newest changes first, including actor, revision, timestamp, patch and before/after settings. Example: {"limit":20}.',
      ...mcpTool('list_model_schema_audit'),
    },
  })
  .get(
    '/god/model-schemas/matrix',
    async ({ query }) => {
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
    {
      modelSchemaAdmin: true,
      query: t.Object({ teamId: t.Optional(t.Numeric()), projectId: t.Optional(t.Numeric()) }),
      response: {
        200: t.Unsafe<
          Awaited<ReturnType<typeof modelMatrix>> & {
            local: Awaited<ReturnType<typeof globalModelStatus>>;
            decisions: Awaited<ReturnType<typeof listClassViews>>;
            browser: Awaited<ReturnType<typeof effectiveBrowserControl>> | null;
          }
        >(matrixResponse),
        ...failures,
      },
      detail: {
        summary: 'Get the model matrix',
        description:
          'Read active schema, matrix revision and effective assignments with schema/project/own sources. Example: {}.',
        ...mcpTool('get_model_schema_matrix'),
      },
    },
  )
  .get('/god/model-schemas/:schemaId', ({ params }) => getSchema(params.schemaId), {
    modelSchemaAdmin: true,
    params: schemaParams,
    response: { 200: schemaResponse, ...failures },
    detail: {
      summary: 'Read one model schema',
      description:
        'Returns schema, builtIn flag, active schema id and current matrix revision. Example: {"schemaId":"nur-codex"}.',
      ...mcpTool('get_model_schema'),
    },
  })
  .post(
    '/god/model-schemas',
    ({ body, schemaActorId, set }) => {
      set.status = 201;
      return createSchema(body, schemaActorId);
    },
    {
      modelSchemaAdmin: true,
      body: createBody,
      response: { 201: schemaResponse, ...failures },
      detail: {
        summary: 'Create or copy a custom model schema',
        description:
          'Creates a draft with empty roles/classes, or copies copyFrom. Built-ins can only be copied. expectedRevision is the global matrix revision; stale writes return 409. Example: {"expectedRevision":0,"id":"custom","name":"Custom","copyFrom":"nur-codex"}.',
        ...mcpTool('create_model_schema'),
      },
    },
  )
  .patch(
    '/god/model-schemas/:schemaId',
    ({ params, body, schemaActorId }) => updateSchema(params.schemaId, body, schemaActorId),
    {
      modelSchemaAdmin: true,
      params: schemaParams,
      body: updateBody,
      response: { 200: schemaResponse, ...failures },
      detail: {
        summary: 'Rename or describe a custom model schema',
        description:
          'Updates metadata with optimistic concurrency. Built-ins return 409. Example: {"schemaId":"custom","expectedRevision":1,"name":"My schema","description":"Personal settings"}.',
        ...mcpTool('update_model_schema'),
      },
    },
  )
  .patch(
    '/god/model-schemas/:schemaId/roles/:role',
    ({ params, body, schemaActorId }) =>
      updateSchemaRole(params.schemaId, params.role, body, schemaActorId),
    {
      modelSchemaAdmin: true,
      params: roleParams,
      body: roleBody,
      response: { 200: schemaResponse, ...failures },
      detail: {
        summary: 'Edit cells of a custom schema role',
        description:
          'Partial row update: runtime, model, reasoning (null for no explicit level), escalation, browser, decision, device. Validates model/runtime and reasoning against the available catalog. A new role starts from the schema general role or local defaults. Active assignments are reprojected; own overrides remain. NPU decisions currently return 409 because evaluation has not passed. Example: {"schemaId":"custom","role":"general","expectedRevision":2,"values":{"runtime":"codex","model":"gpt-6.1-sol","reasoning":"high"}}.',
        ...mcpTool('update_model_schema_role'),
      },
    },
  )
  .delete(
    '/god/model-schemas/:schemaId/roles/:role',
    ({ params, body, schemaActorId }) =>
      removeSchemaRole(params.schemaId, params.role, body.expectedRevision, schemaActorId),
    {
      modelSchemaAdmin: true,
      params: roleParams,
      body: revisionBody,
      response: { 200: schemaResponse, ...failures },
      detail: {
        summary: 'Remove a custom schema role',
        description:
          'Refuses built-ins and the mandatory general role with 409. Agents using this role inherit general; without that fallback removal returns 409. Preserves own overrides, reprojects agents and records an audit entry. Example: {"schemaId":"custom","role":"coder","expectedRevision":3}.',
        ...mcpTool('delete_model_schema_role'),
      },
    },
  )
  .delete(
    '/god/model-schemas/:schemaId',
    ({ params, body, schemaActorId }) =>
      removeSchema(params.schemaId, body.expectedRevision, schemaActorId),
    {
      modelSchemaAdmin: true,
      params: schemaParams,
      body: revisionBody,
      response: { 200: t.Object({ revision: t.Integer(), deleted: t.String() }), ...failures },
      detail: {
        summary: 'Delete a custom model schema',
        description:
          'Refuses built-ins, active schemas and project-bound schemas with 409. Example: {"schemaId":"custom","expectedRevision":3}.',
        ...mcpTool('delete_model_schema'),
      },
    },
  )
  .post('/god/model-schemas/preview', ({ body }) => previewMatrix(body as MatrixPatch), {
    modelSchemaAdmin: true,
    body: patchBody,
    response: {
      200: t.Unsafe<Awaited<ReturnType<typeof previewMatrix>>>(previewResponse),
      ...failures,
    },
    detail: {
      summary: 'Preview model matrix changes',
      description:
        'Validates without writing. Returns affectedAgents, cell changes, nextRevision and retainedOverrides with agent ids and columns. Custom schemas need a general role and available catalog models to activate. Example: {"expectedRevision":3,"active":"custom"}.',
      ...mcpTool(
        'preview_model_schema_changes',
        { readOnlyHint: true, destructiveHint: false },
        'read',
      ),
    },
  })
  .post(
    '/god/model-schemas/apply',
    ({ body, schemaActorId }) => applyMatrix(body as MatrixPatch, schemaActorId),
    {
      modelSchemaAdmin: true,
      body: patchBody,
      response: {
        200: t.Unsafe<Awaited<ReturnType<typeof previewMatrix>>>(previewResponse),
        ...failures,
      },
      detail: {
        summary: 'Apply model matrix changes',
        description:
          'Applies the preview patch transactionally, with revision checking and an audit entry. Built-ins cannot be edited. Own overrides remain. Example: {"expectedRevision":3,"active":"custom"}.',
        ...mcpTool('apply_model_schema_changes'),
      },
    },
  )
  .post(
    '/god/model-schemas/follow-profile',
    ({ body, schemaActorId }) =>
      followLocalProfile(body.profile, { dryRun: body.dryRun, actorId: schemaActorId }),
    {
      modelSchemaAdmin: true,
      body: followProfileBody,
      response: { 200: t.Any(), ...failures },
      detail: {
        summary: 'Bring the local schema and local model pins in line with a local profile',
        description:
          'A local active schema (the built-in one of a profile) and projects that follow one become the schema of the given profile, and agents that pin the model of a local profile by name follow the local default instead. Mixed, cloud and own schemas stay as they are, as do own settings for other models. The model switch itself does this when it commits; this call repairs a state that was left behind. With dryRun it only previews. Example: {"profile":"local-27b-npu","dryRun":true}.',
      },
    },
  );
