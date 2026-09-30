import type {
  AgentChange,
  MatrixColumn,
  MatrixPatch,
  MatrixProfile,
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';

// The changes a person has made in the matrix but not applied yet. They live in the browser
// until "Übernehmen": the server first says what they would do (preview), then writes them
// against the revision the matrix was read at.
export type PendingValues = Partial<Record<MatrixColumn, unknown | null>>;
// The cells changed in one role of a custom schema. `added`: the role is new to the schema, so
// it starts from the schema's own general role (or the local defaults) and is written whole.
export interface PendingSchemaRole {
  values: Partial<MatrixValues>;
  added?: boolean;
}
export interface Pending {
  active?: string;
  // A local profile chosen for the schema that is (or is about to be) the active one.
  profile?: string;
  // projectId → schema id; `null` lets the project follow the active schema again.
  projects: Record<number, string | null>;
  agents: Record<number, { role?: string; values: PendingValues }>;
  // schema id → role → the cells changed in a custom schema.
  schemas: Record<string, Record<string, PendingSchemaRole>>;
}
export const EMPTY_PENDING: Pending = { projects: {}, agents: {}, schemas: {} };

export function setAgentValue(
  pending: Pending,
  agentId: number,
  column: MatrixColumn,
  value: unknown | null,
): Pending {
  const entry = pending.agents[agentId] ?? { values: {} };
  return {
    ...pending,
    agents: {
      ...pending.agents,
      [agentId]: { ...entry, values: { ...entry.values, [column]: value } },
    },
  };
}
export function setAgentRole(pending: Pending, agentId: number, role: string | undefined): Pending {
  const entry = pending.agents[agentId] ?? { values: {} };
  return { ...pending, agents: { ...pending.agents, [agentId]: { ...entry, role } } };
}
export function clearAgentColumn(pending: Pending, agentId: number, column: MatrixColumn): Pending {
  const entry = pending.agents[agentId];
  if (!entry) return pending;
  const { [column]: _dropped, ...values } = entry.values;
  const agents = { ...pending.agents };
  if (Object.keys(values).length === 0 && entry.role === undefined) delete agents[agentId];
  else agents[agentId] = { ...entry, values };
  return { ...pending, agents };
}

export function pendingCount(pending: Pending): number {
  return (
    (pending.active !== undefined ? 1 : 0) +
    (pending.profile !== undefined ? 1 : 0) +
    Object.keys(pending.projects).length +
    schemaCellCount(pending) +
    Object.values(pending.agents).reduce(
      (sum, entry) => sum + Object.keys(entry.values).length + (entry.role !== undefined ? 1 : 0),
      0,
    )
  );
}
// A role added to a schema counts once, a changed role once per changed cell.
export function schemaCellCount(pending: Pending, schemaId?: string): number {
  return Object.entries(pending.schemas)
    .filter(([id]) => schemaId === undefined || id === schemaId)
    .reduce(
      (sum, [, roles]) =>
        sum +
        Object.values(roles).reduce(
          (inner, entry) => inner + Math.max(entry.added ? 1 : 0, Object.keys(entry.values).length),
          0,
        ),
      0,
    );
}
export function pendingAgentCount(pending: Pending): number {
  return Object.keys(pending.agents).length;
}
export function isEmpty(pending: Pending): boolean {
  return pendingCount(pending) === 0;
}

// The schema with another local profile: its classes, slots and speech recognition come
// from the profile.
export function schemaWithProfile(schema: MatrixSchema, profile: MatrixProfile): MatrixSchema {
  return {
    ...schema,
    profile: profile.id,
    classes: profile.classes,
    npuSlots: profile.npuSlots,
    gpuSlots: profile.gpuSlots,
    speechRecognition: profile.speechRecognition,
  };
}

// The schema a profile change would be written to: the one that is active once the pending
// changes are applied.
export function targetSchemaId(matrix: ModelMatrix, pending: Pending): string {
  return pending.active ?? matrix.active;
}

// The values a new role of a schema starts from: the schema's own general role, else the
// general role of the local schema (what the server does for a role it is asked to add).
export function roleBase(matrix: ModelMatrix, schemaId: string): MatrixValues | undefined {
  return matrix.schemas[schemaId]?.roles.general ?? matrix.schemas['nur-lokal']?.roles.general;
}

// The role as it stands once the changes made to it are counted.
export function schemaRoleValues(
  matrix: ModelMatrix,
  pending: Pending,
  schemaId: string,
  role: string,
): { values: MatrixValues; staged: Set<keyof MatrixValues>; added: boolean } | undefined {
  const stored = matrix.schemas[schemaId]?.roles[role];
  const change = pending.schemas[schemaId]?.[role];
  const base = stored ?? (change?.added ? roleBase(matrix, schemaId) : undefined);
  if (!base) return undefined;
  return {
    values: { ...base, ...change?.values },
    staged: new Set(Object.keys(change?.values ?? {}) as (keyof MatrixValues)[]),
    added: !stored && !!change?.added,
  };
}

// The schema as it would be written: with the profile chosen for it and the roles changed.
export function schemaWithPending(
  matrix: ModelMatrix,
  pending: Pending,
  schemaId: string,
): MatrixSchema | undefined {
  const stored = matrix.schemas[schemaId];
  if (!stored) return undefined;
  let schema: MatrixSchema = { ...stored };
  delete schema.builtIn;
  const roles = { ...stored.roles };
  for (const role of Object.keys(pending.schemas[schemaId] ?? {})) {
    const merged = schemaRoleValues(matrix, pending, schemaId, role);
    if (merged) roles[role] = merged.values;
  }
  schema = { ...schema, roles };
  const profile = matrix.profiles.find((entry) => entry.id === pending.profile);
  if (profile && schemaId === targetSchemaId(matrix, pending))
    schema = schemaWithProfile(schema, profile);
  return schema;
}

export function buildPatch(matrix: ModelMatrix, pending: Pending): MatrixPatch {
  const patch: MatrixPatch = { expectedRevision: matrix.revision };
  if (pending.active !== undefined) patch.active = pending.active;
  // Every schema to write goes in once: one with a new profile and changed roles as well.
  const ids = new Set(Object.keys(pending.schemas));
  if (pending.profile !== undefined) ids.add(targetSchemaId(matrix, pending));
  const schemas = [...ids]
    .map((id) => schemaWithPending(matrix, pending, id))
    .filter((schema): schema is MatrixSchema => !!schema);
  if (schemas.length === 1) patch.schema = schemas[0];
  else if (schemas.length > 1) patch.schemas = schemas;
  const projects = Object.entries(pending.projects).map(([projectId, schemaId]) => ({
    projectId: Number(projectId),
    schemaId,
  }));
  if (projects.length) patch.projects = projects;
  const agents: AgentChange[] = Object.entries(pending.agents).map(([agentId, entry]) => ({
    agentId: Number(agentId),
    ...(entry.role !== undefined ? { role: entry.role } : {}),
    values: entry.values as AgentChange['values'],
  }));
  if (agents.length) patch.agents = agents;
  return patch;
}

// Changes to a role of a custom schema.
export function setSchemaCells(
  pending: Pending,
  schemaId: string,
  role: string,
  values: Partial<MatrixValues>,
  added?: boolean,
): Pending {
  const roles = pending.schemas[schemaId] ?? {};
  const entry = roles[role] ?? { values: {} };
  return {
    ...pending,
    schemas: {
      ...pending.schemas,
      [schemaId]: {
        ...roles,
        [role]: {
          values: { ...entry.values, ...values },
          ...(added || entry.added ? { added: true } : {}),
        },
      },
    },
  };
}

// Takes one changed cell back; a role that is left with nothing to say (and was there before)
// and a schema without changes leave the list.
export function clearSchemaCell(
  pending: Pending,
  schemaId: string,
  role: string,
  column: keyof MatrixValues,
): Pending {
  const entry = pending.schemas[schemaId]?.[role];
  if (!entry) return pending;
  const { [column]: _dropped, ...values } = entry.values;
  const roles = { ...pending.schemas[schemaId] };
  if (Object.keys(values).length === 0 && !entry.added) delete roles[role];
  else roles[role] = { ...entry, values };
  return withSchemaRoles(pending, schemaId, roles);
}

// Drops the changed cells that say what the role already has, so a value put back is not a
// change any more.
export function pruneSchemaRole(
  pending: Pending,
  matrix: ModelMatrix,
  schemaId: string,
  role: string,
): Pending {
  const entry = pending.schemas[schemaId]?.[role];
  const stored = matrix.schemas[schemaId]?.roles[role];
  if (!entry || !stored) return pending;
  let next = pending;
  for (const column of Object.keys(entry.values) as (keyof MatrixValues)[])
    if (JSON.stringify(entry.values[column]) === JSON.stringify(stored[column]))
      next = clearSchemaCell(next, schemaId, role, column);
  return next;
}

// Takes a role's changes back whole (a role added is gone again).
export function discardSchemaRole(pending: Pending, schemaId: string, role: string): Pending {
  const roles = { ...pending.schemas[schemaId] };
  delete roles[role];
  return withSchemaRoles(pending, schemaId, roles);
}

// Forgets everything staged for a schema (it was deleted).
export function discardSchema(pending: Pending, schemaId: string): Pending {
  return withSchemaRoles(pending, schemaId, {});
}

function withSchemaRoles(
  pending: Pending,
  schemaId: string,
  roles: Record<string, PendingSchemaRole>,
): Pending {
  const schemas = { ...pending.schemas };
  if (Object.keys(roles).length === 0) delete schemas[schemaId];
  else schemas[schemaId] = roles;
  return { ...pending, schemas };
}

// The role groups of the matrix: Home, the coordinators, everyone else.
export type AgentGroup = 'home' | 'coordinator' | 'specialist';
export function agentGroup(role: string, organizationRole?: string | null, isHome?: boolean) {
  if (isHome || role === 'home') return 'home' as const;
  if (organizationRole === 'coordinator' || role === 'coordinator') return 'coordinator' as const;
  return 'specialist' as const;
}
