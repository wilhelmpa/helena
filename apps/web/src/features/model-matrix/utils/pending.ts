import type {
  AgentChange,
  MatrixColumn,
  MatrixPatch,
  MatrixProfile,
  MatrixSchema,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';

// The changes a person has made in the matrix but not applied yet. They live in the browser
// until "Übernehmen": the server first says what they would do (preview), then writes them
// against the revision the matrix was read at.
export type PendingValues = Partial<Record<MatrixColumn, unknown | null>>;
export interface Pending {
  active?: string;
  // A local profile chosen for the schema that is (or is about to be) the active one.
  profile?: string;
  // projectId → schema id; `null` lets the project follow the active schema again.
  projects: Record<number, string | null>;
  agents: Record<number, { role?: string; values: PendingValues }>;
}
export const EMPTY_PENDING: Pending = { projects: {}, agents: {} };

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
    Object.values(pending.agents).reduce(
      (sum, entry) => sum + Object.keys(entry.values).length + (entry.role !== undefined ? 1 : 0),
      0,
    )
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

export function buildPatch(matrix: ModelMatrix, pending: Pending): MatrixPatch {
  const patch: MatrixPatch = { expectedRevision: matrix.revision };
  if (pending.active !== undefined) patch.active = pending.active;
  if (pending.profile !== undefined) {
    const profile = matrix.profiles.find((entry) => entry.id === pending.profile);
    const schema = matrix.schemas[targetSchemaId(matrix, pending)];
    if (profile && schema) patch.schema = schemaWithProfile(schema, profile);
  }
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

// The role groups of the matrix: Home, the coordinators, everyone else.
export type AgentGroup = 'home' | 'coordinator' | 'specialist';
export function agentGroup(role: string, organizationRole?: string | null, isHome?: boolean) {
  if (isHome || role === 'home') return 'home' as const;
  if (organizationRole === 'coordinator' || role === 'coordinator') return 'coordinator' as const;
  return 'specialist' as const;
}
