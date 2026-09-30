import { t } from 'elysia';
import { MODEL_ROLES } from './templates';

const oneOf = <T extends readonly string[]>(values: T) =>
  t.Unsafe<T[number]>(t.Union(values.map((value) => t.Literal(value))));
export const revisionBody = t.Object({ expectedRevision: t.Integer({ minimum: 0 }) });
export const schemaParams = t.Object({ schemaId: t.String({ pattern: '^[a-z][a-z0-9-]{1,63}$' }) });
const decision = t.Object({
  backend: oneOf(['jev', 'gpu', 'npu', 'jev-local', 'local-jev'] as const),
  threshold: t.Number({ minimum: 0, maximum: 1 }),
  fallback: oneOf(['gpu', 'coordinator', 'none'] as const),
  privateData: t.Boolean(),
});
const escalation = t.Object({
  target: t.Optional(oneOf(['codex', 'claude'] as const)),
  model: t.Nullable(t.String({ minLength: 1, maxLength: 150 })),
  afterFailures: t.Integer({ minimum: 0, maximum: 5 }),
  onResumeLimit: t.Boolean(),
  onRequest: t.Boolean(),
  maxDepth: t.Integer({ minimum: 0, maximum: 1 }),
});
export const valuesBody = t.Object({
  runtime: oneOf(['helena', 'claude', 'codex', 'hermes', 'command', 'webhook'] as const),
  model: t.String({ minLength: 1, maxLength: 150 }),
  reasoning: t.Nullable(t.String({ minLength: 1, maxLength: 32 })),
  escalation,
  browser: oneOf(['standard', 'jev', 'combined'] as const),
  decision,
  device: oneOf(['gpu', 'npu', 'cloud', 'cpu'] as const),
  toolProfile: t.Optional(oneOf(['assistent', 'recherche', 'coder-lite', 'voll'] as const)),
});
export const createBody = t.Object({
  ...revisionBody.properties,
  id: schemaParams.properties.schemaId,
  name: t.String({ minLength: 1, maxLength: 120 }),
  description: t.Optional(t.String({ maxLength: 2000 })),
  copyFrom: t.Optional(schemaParams.properties.schemaId),
});
export const updateBody = t.Object({
  ...revisionBody.properties,
  name: t.Optional(createBody.properties.name),
  description: createBody.properties.description,
});
export const roleParams = t.Object({ ...schemaParams.properties, role: oneOf(MODEL_ROLES) });
export const roleBody = t.Object({
  ...revisionBody.properties,
  values: t.Partial(valuesBody, { additionalProperties: false }),
});
export const classBody = t.Object({
  backend: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
  device: oneOf(['gpu', 'npu', 'cpu', 'cloud', 'vulkan'] as const),
  model: t.String({ minLength: 1, maxLength: 150 }),
  eval: oneOf(['passed', 'failed', 'untested'] as const),
  score: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  decision: t.Optional(decision),
});
export const schemaBody = t.Object({
  id: schemaParams.properties.schemaId,
  name: createBody.properties.name,
  description: t.String({ maxLength: 2000 }),
  profile: t.String({ maxLength: 80 }),
  roles: t.Record(t.String(), valuesBody),
  classes: t.Record(t.String(), classBody),
  npuSlots: t.Integer({ minimum: 0, maximum: 1 }),
  gpuSlots: t.Integer({ minimum: 1, maximum: 8 }),
  speechRecognition: oneOf(['cpu', 'npu'] as const),
  jevPrivate: t.Boolean(),
});
export const schemaView = t.Object({ ...schemaBody.properties, builtIn: t.Boolean() });
export const schemaResponse = t.Object({
  revision: t.Integer(),
  active: t.String(),
  schema: schemaView,
});
export const catalogModel = t.Object({
  id: t.String(),
  name: t.String(),
  runtime: t.String(),
  reasoning: t.Boolean(),
  thinkingLevels: t.Array(t.String()),
  thinkingDefault: t.Nullable(t.String()),
  provider: t.Optional(t.String()),
  local: t.Optional(t.Boolean()),
  listed: t.Optional(t.Boolean()),
  variantOf: t.Optional(t.String()),
  verified: t.Optional(t.Boolean()),
});
export const listResponse = t.Object({
  revision: t.Integer(),
  active: t.String(),
  schemas: t.Array(schemaView),
  roles: t.Array(t.String()),
  columns: t.Array(t.String()),
  catalog: t.Array(catalogModel),
  runtimes: t.Array(
    t.Object({ runtime: t.String(), selectable: t.Boolean(), reason: t.Nullable(t.String()) }),
  ),
});
export const previewResponse = t.Object({
  revision: t.Integer(),
  nextRevision: t.Integer(),
  affectedAgents: t.Integer(),
  changes: t.Array(t.Any()),
  retainedOverrides: t.Array(
    t.Object({
      agentId: t.Integer(),
      username: t.String(),
      schemaId: t.String(),
      columns: t.Array(t.String()),
    }),
  ),
});
export const matrixResponse = t.Object({
  revision: t.Integer(),
  active: t.String(),
  schemas: t.Record(t.String(), schemaView),
  projects: t.Record(t.String(), t.String()),
  agents: t.Array(t.Any()),
  profiles: t.Array(t.Any()),
  classes: t.Array(t.Any()),
  undo: t.Any(),
  local: t.Any(),
  decisions: t.Array(t.Any()),
  browser: t.Any(),
});
export const patchBody = t.Object({
  ...revisionBody.properties,
  active: t.Optional(schemaParams.properties.schemaId),
  projects: t.Optional(
    t.Array(
      t.Object({
        projectId: t.Integer({ minimum: 1 }),
        schemaId: t.Nullable(schemaParams.properties.schemaId),
      }),
    ),
  ),
  agents: t.Optional(
    t.Array(
      t.Object({
        agentId: t.Integer({ minimum: 1 }),
        role: t.Optional(oneOf(MODEL_ROLES)),
        values: t.Record(t.String(), t.Any()),
      }),
    ),
  ),
  schema: t.Optional(schemaBody),
  schemas: t.Optional(t.Array(schemaBody)),
  removeSchema: t.Optional(schemaParams.properties.schemaId),
  undo: t.Optional(t.Boolean()),
});
