import {
  aiAgent,
  appSetting,
  db,
  helenaLocalAiEval,
  helenaModelServer,
  project,
  projectMember,
} from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { HttpError } from '#shared/lib';
import { normalizeAgentEscalation } from '#modules/agents/core/service';
import { migrateSchemaEscalations, migrateEscalationValue } from './migration';
import {
  COMBO_EVAL_CANDIDATES,
  MODEL_COLUMNS,
  MODEL_ROLES,
  MODEL_TEMPLATES,
  LOCAL_PROFILE_TEMPLATES,
  type ModelColumn,
  type ModelSchema,
  type ModelValues,
} from './templates';

const KEY = 'volition.modelSchemas';
type State = {
  revision: number;
  active: string;
  schemas: Record<string, ModelSchema>;
  projects: Record<string, string>;
  history: HistoryEntry[];
};
// What an apply changed on agents, as the agents were before it: their role and own values.
// An undo puts them back with the schema state. Entries written before this existed have none.
type SavedAgent = { agentId: number; modelRole: string; modelOverrides: Record<string, unknown> };
type HistoryEntry = {
  revision: number;
  active: string;
  schemas: Record<string, ModelSchema>;
  projects: Record<string, string>;
  agents?: SavedAgent[];
};
// How many applies can be taken back one after the other.
export const UNDO_DEPTH = 10;
type Change = {
  agentId: number;
  role?: string;
  values: Partial<Record<ModelColumn, ModelValues[ModelColumn] | null>>;
};
export type MatrixPatch = {
  expectedRevision: number;
  active?: string;
  projects?: { projectId: number; schemaId: string | null }[];
  agents?: Change[];
  schema?: ModelSchema;
  removeSchema?: string;
  undo?: boolean;
};
type Row = {
  id: number;
  teamId: number;
  userId: string;
  username: string;
  agentRole: string;
  projectScope: string;
  modelRole: string;
  modelOverrides: Record<string, unknown>;
  model: string | null;
  runtimePolicy: unknown;
  template: boolean;
};
type Membership = { userId: string; projectId: number; projectRole: string; projectKey: string };

export function defaultState(): State {
  return {
    revision: 0,
    active: 'nur-lokal',
    schemas: structuredClone(MODEL_TEMPLATES),
    projects: {},
    history: [],
  };
}
function stateOf(raw: unknown): State {
  if (!raw || typeof raw !== 'object') return defaultState();
  const value = raw as State;
  return migrateSchemaEscalations({
    ...defaultState(),
    ...value,
    schemas: { ...MODEL_TEMPLATES, ...value.schemas },
  });
}
export async function readModelState(): Promise<State> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, KEY));
  return stateOf(row?.value);
}
export async function initialAgentModel(input: {
  home: boolean;
  role?: string;
  projectIds: number[];
  projectScope?: string;
  sourceTemplateId?: number | null;
  model?: string | null;
  runtimePolicy?: Record<string, unknown> | null;
}) {
  const state = await readModelState();
  const [source] = input.sourceTemplateId
    ? await db
        .select({ role: aiAgent.modelRole, overrides: aiAgent.modelOverrides })
        .from(aiAgent)
        .where(eq(aiAgent.id, input.sourceTemplateId))
    : [];
  const role = input.home ? 'home' : (input.role ?? source?.role ?? 'general');
  const schemaId =
    input.home || input.projectScope === 'all' || input.projectIds.length !== 1
      ? state.active
      : (state.projects[input.projectIds[0]!] ?? state.active);
  const values =
    (state.schemas[schemaId] ?? MODEL_TEMPLATES['nur-lokal']!).roles[role] ??
    state.schemas[schemaId]!.roles.general;
  const own: Record<string, unknown> = {};
  if (input.model != null && (!source || source.overrides.model !== undefined))
    own.model = input.model;
  if (input.runtimePolicy?.runtime != null && (!source || source.overrides.runtime !== undefined))
    own.runtime = input.runtimePolicy.runtime;
  if (
    input.runtimePolicy?.reasoningEffort != null &&
    (!source || source.overrides.reasoning !== undefined)
  )
    own.reasoning = input.runtimePolicy.reasoningEffort;
  const explicitEscalation = input.runtimePolicy?.escalation;
  if (explicitEscalation && (!source || source.overrides.escalation !== undefined)) {
    own.escalation = normalizeAgentEscalation(explicitEscalation);
  }
  return {
    role,
    overrides: own,
    model: (own.model as string | undefined) ?? values.model,
    runtimePolicy: projectedPolicy(input.runtimePolicy ?? {}, {
      ...values,
      runtime: (own.runtime as ModelValues['runtime']) ?? values.runtime,
      reasoning: (own.reasoning as ModelValues['reasoning']) ?? values.reasoning,
      escalation: (own.escalation as ModelValues['escalation']) ?? values.escalation,
    }),
  };
}
function projectedPolicy(
  policy: Record<string, unknown>,
  values: ModelValues,
): Record<string, unknown> {
  const helena = { ...((policy.helena ?? {}) as Record<string, unknown>) };
  delete helena.escalation;
  return {
    ...policy,
    ...(policy.helena ? { helena } : {}),
    runtime: values.runtime,
    reasoningEffort: values.reasoning,
    escalation: normalizeAgentEscalation(values.escalation),
  };
}
async function validateSchema(schema: ModelSchema) {
  if (!schema || typeof schema !== 'object') throw new HttpError(400, 'Invalid schema');
  if (
    !/^[a-z][a-z0-9-]{1,63}$/.test(schema.id) ||
    !schema.name?.trim() ||
    typeof schema.description !== 'string' ||
    !schema.roles?.general ||
    !schema.classes ||
    typeof schema.classes !== 'object'
  )
    throw new HttpError(400, 'Schema needs an id, name and general role');
  if (!LOCAL_PROFILE_TEMPLATES.some((profile) => profile.id === schema.profile))
    throw new HttpError(400, 'Unknown local profile');
  for (const [role, values] of Object.entries(schema.roles)) {
    if (!MODEL_ROLES.includes(role as never)) throw new HttpError(400, `Unknown role ${role}`);
    if (MODEL_COLUMNS.some((column) => values[column] === undefined))
      throw new HttpError(400, `Incomplete role ${role}`);
    validateValues(values);
  }
  for (const [id, placement] of Object.entries(schema.classes ?? {})) {
    if (
      !/^[a-z][a-z0-9.-]{0,79}$/.test(id) ||
      !placement?.model ||
      !['gpu', 'npu', 'cpu', 'cloud', 'vulkan'].includes(placement.device) ||
      !['passed', 'failed', 'untested'].includes(placement.eval) ||
      (placement.score !== undefined &&
        (!Number.isFinite(placement.score) || placement.score < 0 || placement.score > 1))
    )
      throw new HttpError(400, `Invalid class ${id}`);
    if (placement.device === 'npu' && placement.eval !== 'passed')
      throw new HttpError(409, `NPU class ${id} needs a passed eval`);
    if (
      placement.device === 'npu' &&
      !(placement.model === 'qwen3.5:2b' && ['triage', 'routines', 'hermes-helpers'].includes(id))
    ) {
      const [latest] = await db
        .select({ passed: helenaLocalAiEval.passed, status: helenaLocalAiEval.status })
        .from(helenaLocalAiEval)
        .innerJoin(helenaModelServer, eq(helenaModelServer.id, helenaLocalAiEval.serverId))
        .where(
          and(
            eq(helenaLocalAiEval.classId, id),
            eq(helenaLocalAiEval.model, placement.model),
            eq(helenaModelServer.kind, 'fastflowlm'),
          ),
        )
        .orderBy(desc(helenaLocalAiEval.ranAt))
        .limit(1);
      if (!latest?.passed || latest.status !== 'done')
        throw new HttpError(409, `NPU class ${id} needs a passed eval`);
    }
    if (placement.decision) validateDecision(placement.decision);
  }
  if (
    !Number.isInteger(schema.npuSlots) ||
    schema.npuSlots < 0 ||
    schema.npuSlots > 1 ||
    !Number.isInteger(schema.gpuSlots) ||
    schema.gpuSlots < 1 ||
    schema.gpuSlots > 8 ||
    !['cpu', 'npu'].includes(schema.speechRecognition) ||
    typeof schema.jevPrivate !== 'boolean'
  )
    throw new HttpError(400, 'Invalid slot count');
}
function validateDecision(value: ModelValues['decision']) {
  if (
    !value ||
    typeof value !== 'object' ||
    !['jev', 'gpu', 'npu', 'jev-local', 'local-jev'].includes(value.backend) ||
    !Number.isFinite(value.threshold) ||
    value.threshold < 0 ||
    value.threshold > 1 ||
    !['gpu', 'coordinator', 'none'].includes(value.fallback) ||
    typeof value.privateData !== 'boolean'
  )
    throw new HttpError(400, 'Invalid decision setting');
  if (value.backend === 'npu') throw new HttpError(409, 'NPU decision eval has not passed');
}
function validateValues(value: Partial<ModelValues>) {
  if (
    value.runtime !== undefined &&
    !['helena', 'claude', 'codex', 'hermes', 'command', 'webhook'].includes(value.runtime)
  )
    throw new HttpError(400, 'Invalid runtime');
  if (
    value.model !== undefined &&
    (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 150)
  )
    throw new HttpError(400, 'Invalid model');
  if (
    value.reasoning !== undefined &&
    !['low', 'medium', 'high', 'xhigh'].includes(value.reasoning)
  )
    throw new HttpError(400, 'Invalid reasoning');
  if (value.browser !== undefined && !['standard', 'jev', 'combined'].includes(value.browser))
    throw new HttpError(400, 'Invalid browser control');
  if (value.device !== undefined && !['gpu', 'npu', 'cloud', 'cpu'].includes(value.device))
    throw new HttpError(400, 'Invalid device');
  if (value.decision !== undefined) validateDecision(value.decision);
  if (value.escalation !== undefined) {
    const e = value.escalation;
    if (!e || typeof e !== 'object') throw new HttpError(400, 'Invalid escalation setting');
    if (!isDeepStrictEqual(e, normalizeAgentEscalation(e)))
      throw new HttpError(400, 'Invalid escalation policy');
  }
}
async function inventory(teamId?: number) {
  const agents = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      userId: aiAgent.userId,
      username: aiAgent.username,
      agentRole: aiAgent.agentRole,
      projectScope: aiAgent.projectScope,
      modelRole: aiAgent.modelRole,
      modelOverrides: aiAgent.modelOverrides,
      model: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
      template: aiAgent.template,
    })
    .from(aiAgent)
    .where(teamId ? eq(aiAgent.teamId, teamId) : undefined);
  const memberships = await db
    .select({
      userId: projectMember.userId,
      projectId: project.id,
      projectRole: project.projectRole,
      projectKey: project.key,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId));
  return { agents: agents as Row[], memberships };
}
function inheritedProject(row: Row, memberships: Membership[]) {
  if (row.agentRole === 'home' || row.projectScope === 'all' || row.template) return null;
  const relevant = memberships.filter(
    (entry) => entry.userId === row.userId && entry.projectRole === 'project',
  );
  return relevant.length === 1 ? relevant[0]! : null;
}
export function resolveRow(row: Row, memberships: Membership[], state: State) {
  const member = inheritedProject(row, memberships);
  const projectSchema = member ? state.projects[member.projectId] : null;
  const schemaId = projectSchema ?? state.active;
  const schema =
    state.schemas[schemaId] ?? state.schemas[state.active] ?? MODEL_TEMPLATES['nur-lokal']!;
  const base = schema.roles[row.modelRole] ?? schema.roles.general;
  const cells = {} as {
    [K in ModelColumn]: {
      value: ModelValues[K];
      source: 'schema' | 'project' | 'own';
    };
  };
  for (const key of MODEL_COLUMNS) {
    const raw = row.modelOverrides?.[key];
    const own =
      key === 'escalation' && raw != null
        ? migrateEscalationValue(
            raw,
            (row.runtimePolicy as { escalation?: unknown } | null)?.escalation,
          )
        : raw;
    Object.assign(cells, {
      [key]: {
        value: own ?? base[key],
        source: own === undefined || own === null ? (projectSchema ? 'project' : 'schema') : 'own',
      },
    });
  }
  return {
    id: row.id,
    teamId: row.teamId,
    username: row.username,
    role: row.modelRole,
    project: member ? { id: member.projectId, key: member.projectKey } : null,
    schemaId,
    cells,
  };
}
export async function modelMatrix(teamId?: number, projectId?: number) {
  const state = await readModelState();
  const { agents, memberships } = await inventory(teamId);
  const rows = agents
    .filter(
      (agent) =>
        !agent.template &&
        (projectId === undefined ||
          memberships.some(
            (member) => member.userId === agent.userId && member.projectId === projectId,
          )),
    )
    .map((agent) => resolveRow(agent, memberships, state));
  const classSchemaId =
    projectId === undefined ? state.active : (state.projects[projectId] ?? state.active);
  const schema = state.schemas[classSchemaId]!;
  return {
    revision: state.revision,
    // What an undo can take back: the last applies, newest last, and how many agents each
    // changed (null: written before agent changes were kept, only the schemas come back).
    undo: {
      depth: state.history.length,
      steps: state.history.map((entry) => ({
        revision: entry.revision,
        agents: entry.agents ? entry.agents.length : null,
      })),
    },
    active: state.active,
    schemas: state.schemas,
    profiles: LOCAL_PROFILE_TEMPLATES,
    projects: state.projects,
    agents: rows,
    classes: Object.entries(schema.classes).map(([id, value]) => ({
      id,
      ...value,
      candidates: [
        ...(id in COMBO_EVAL_CANDIDATES
          ? Object.entries(COMBO_EVAL_CANDIDATES[id as keyof typeof COMBO_EVAL_CANDIDATES]).map(
              ([kind, score]) => ({
                device: kind === 'vulkan' ? 'vulkan' : 'npu',
                model:
                  kind === 'npuEmbed'
                    ? 'embed-gemma:300m'
                    : kind === 'vulkan'
                      ? 'Qwen3-Embedding-0.6B'
                      : 'qwen3.5:2b',
                score,
                eval:
                  kind === 'vulkan' ||
                  (['triage', 'routines', 'hermes-helpers'].includes(id) && kind === 'npu2b')
                    ? 'passed'
                    : 'failed',
              }),
            )
          : []),
        ...(id in COMBO_EVAL_CANDIDATES && id !== 'embeddings'
          ? [{ device: 'npu', model: 'qwen3.5:4b', eval: 'failed' }]
          : []),
      ],
    })),
  };
}
export async function agentBrowserMode(agentId: number) {
  const state = await readModelState();
  const { agents, memberships } = await inventory();
  const agent = agents.find((entry) => entry.id === agentId);
  return agent ? resolveRow(agent, memberships, state).cells.browser : null;
}
export async function agentDecisionSetting(agentId: number) {
  const state = await readModelState();
  const { agents, memberships } = await inventory();
  const agent = agents.find((entry) => entry.id === agentId);
  if (!agent) return null;
  const row = resolveRow(agent, memberships, state);
  return row.cells.decision.source === 'own' ? row.cells.decision.value : null;
}
function projectionOf(agent: Row, memberships: Membership[], state: State) {
  const cells = resolveRow(agent, memberships, state).cells;
  const values = Object.fromEntries(
    MODEL_COLUMNS.map((key) => [key, cells[key].value]),
  ) as ModelValues;
  return {
    model: ['command', 'webhook'].includes(cells.runtime.value) ? agent.model : cells.model.value,
    runtimePolicy: projectedPolicy(agent.runtimePolicy as Record<string, unknown>, values),
  };
}
export async function modelProjectionDrift() {
  const state = await readModelState();
  const { agents, memberships } = await inventory();
  return agents
    .filter((agent) => {
      const desired = projectionOf(agent, memberships, state);
      return (
        agent.model !== desired.model ||
        !isDeepStrictEqual(agent.runtimePolicy, desired.runtimePolicy)
      );
    })
    .map((agent) => agent.id);
}
export async function syncAgentModel(agentId: number) {
  const state = await readModelState();
  const { agents, memberships } = await inventory();
  const agent = agents.find((entry) => entry.id === agentId);
  if (!agent) return false;
  const desired = projectionOf(agent, memberships, state);
  if (
    agent.model === desired.model &&
    isDeepStrictEqual(agent.runtimePolicy, desired.runtimePolicy)
  )
    return false;
  await db.update(aiAgent).set(desired).where(eq(aiAgent.id, agentId));
  return true;
}
// The agents a change touches, as they are now (what an undo restores).
export function savedAgents(agents: Row[], changes: Change[]): SavedAgent[] {
  return changes.flatMap((change) => {
    const row = agents.find((entry) => entry.id === change.agentId);
    return row
      ? [
          {
            agentId: row.id,
            modelRole: row.modelRole,
            modelOverrides: structuredClone(row.modelOverrides),
          },
        ]
      : [];
  });
}
// An undo takes back the last apply: the schema state, and the roles and own values of the
// agents it changed. It goes one step further back each time (up to UNDO_DEPTH) and is not
// itself put on the history.
export function nextState(current: State, patch: MatrixPatch, saved: SavedAgent[] = []): State {
  const state: State = structuredClone(current);
  if (patch.undo) {
    const previous = state.history.pop();
    if (!previous) throw new HttpError(409, 'No previous schema change');
    state.active = previous.active;
    state.schemas = previous.schemas;
    state.projects = previous.projects;
    state.revision = current.revision + 1;
    return state;
  } else {
    if (patch.schema) state.schemas[patch.schema.id] = patch.schema;
    if (patch.removeSchema) {
      if (MODEL_TEMPLATES[patch.removeSchema])
        throw new HttpError(409, 'Built-in schemas cannot be removed');
      if (
        patch.removeSchema === state.active ||
        Object.values(state.projects).includes(patch.removeSchema)
      )
        throw new HttpError(409, 'Schema is still in use');
      delete state.schemas[patch.removeSchema];
    }
    if (patch.active) {
      if (!state.schemas[patch.active]) throw new HttpError(404, 'Unknown schema');
      state.active = patch.active;
    }
    for (const entry of patch.projects ?? []) {
      if (entry.schemaId !== null && !state.schemas[entry.schemaId])
        throw new HttpError(404, 'Unknown schema');
      if (entry.schemaId === null) delete state.projects[entry.projectId];
      else state.projects[entry.projectId] = entry.schemaId;
    }
  }
  state.history.push({
    revision: current.revision,
    active: current.active,
    schemas: current.schemas,
    projects: current.projects,
    agents: saved,
  });
  state.history = state.history.slice(-UNDO_DEPTH);
  state.revision = current.revision + 1;
  return state;
}
export function changedRows(
  agents: Row[],
  memberships: Membership[],
  current: State,
  next: State,
  changes: Change[],
  restore: SavedAgent[] = [],
) {
  const override = new Map<number, Record<string, unknown>>();
  const roles = new Map<number, string>();
  // The saved values are what the agent had before the change being taken back, and were
  // checked when they were written: they replace the current ones as they are.
  for (const saved of restore) {
    const row = agents.find((entry) => entry.id === saved.agentId);
    if (!row) continue;
    override.set(row.id, structuredClone(saved.modelOverrides));
    if (saved.modelRole !== row.modelRole) roles.set(row.id, saved.modelRole);
  }
  for (const change of changes) {
    const row = agents.find((entry) => entry.id === change.agentId);
    if (!row) throw new HttpError(404, `Unknown agent ${change.agentId}`);
    if (change.role !== undefined) {
      if (!MODEL_ROLES.includes(change.role as never)) throw new HttpError(400, 'Unknown role');
      roles.set(row.id, change.role);
    }
    const values = { ...row.modelOverrides };
    if (change.role !== undefined) values.role = change.role;
    for (const [key, value] of Object.entries(change.values)) {
      if (!MODEL_COLUMNS.includes(key as ModelColumn))
        throw new HttpError(400, `Unknown column ${key}`);
      if (value === null) delete values[key];
      else {
        validateValues({ [key]: value });
        values[key] = value;
      }
    }
    override.set(row.id, values);
  }
  return agents
    .map((row) => {
      const before = resolveRow(row, memberships, current);
      const after = resolveRow(
        {
          ...row,
          modelRole: roles.get(row.id) ?? row.modelRole,
          modelOverrides: override.get(row.id) ?? row.modelOverrides,
        },
        memberships,
        next,
      );
      const changes = MODEL_COLUMNS.filter(
        (key) => JSON.stringify(before.cells[key]) !== JSON.stringify(after.cells[key]),
      ).map((key) => ({ column: key, before: before.cells[key], after: after.cells[key] }));
      return {
        row,
        before,
        after,
        changes,
        overrides: override.get(row.id),
        role: roles.get(row.id),
      };
    })
    .filter((entry) => entry.changes.length || entry.overrides || entry.role);
}
export async function previewMatrix(patch: MatrixPatch) {
  if (
    patch.undo &&
    (patch.active ||
      patch.schema ||
      patch.removeSchema ||
      patch.projects?.length ||
      patch.agents?.length)
  )
    throw new HttpError(400, 'Undo must be a separate change');
  const agentIds = (patch.agents ?? []).map((entry) => entry.agentId);
  const projectIdsInPatch = (patch.projects ?? []).map((entry) => entry.projectId);
  if (
    new Set(agentIds).size !== agentIds.length ||
    new Set(projectIdsInPatch).size !== projectIdsInPatch.length
  )
    throw new HttpError(400, 'Duplicate changes in one batch');
  if (patch.schema) await validateSchema(patch.schema);
  const current = await readModelState();
  if (patch.expectedRevision !== current.revision)
    throw new HttpError(409, 'Schema revision changed');
  const { agents, memberships } = await inventory();
  const next = nextState(current, patch, savedAgents(agents, patch.agents ?? []));
  const projectIds = new Set(
    (await db.select({ id: project.id }).from(project)).map((entry) => entry.id),
  );
  for (const change of patch.projects ?? [])
    if (!projectIds.has(change.projectId)) throw new HttpError(404, 'Unknown project');
  const rows = changedRows(
    agents,
    memberships,
    current,
    next,
    patch.agents ?? [],
    patch.undo ? (current.history.at(-1)?.agents ?? []) : [],
  );
  return {
    revision: current.revision,
    nextRevision: next.revision,
    affectedAgents: rows.filter((row) => row.changes.length || row.role).length,
    changes: rows.map(({ row, changes, role }) => ({
      agentId: row.id,
      username: row.username,
      role: role ?? row.modelRole,
      changes,
    })),
  };
}
export async function applyMatrix(patch: MatrixPatch) {
  const preview = await previewMatrix(patch);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(121225)`);
    const [stored] = await tx
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, KEY));
    const current = stateOf(stored?.value);
    if (current.revision !== patch.expectedRevision)
      throw new HttpError(409, 'Schema revision changed');
    const { agents, memberships } = await inventory();
    const next = nextState(current, patch, savedAgents(agents, patch.agents ?? []));
    const rows = changedRows(
      agents,
      memberships,
      current,
      next,
      patch.agents ?? [],
      patch.undo ? (current.history.at(-1)?.agents ?? []) : [],
    );
    await tx
      .insert(appSetting)
      .values({ key: KEY, value: next })
      .onConflictDoUpdate({
        target: appSetting.key,
        set: { value: next, updatedAt: new Date() },
      });
    for (const entry of rows) {
      const cells = entry.after.cells;
      const policy = projectedPolicy(
        entry.row.runtimePolicy as Record<string, unknown>,
        Object.fromEntries(MODEL_COLUMNS.map((key) => [key, cells[key].value])) as ModelValues,
      );
      const updated = await tx
        .update(aiAgent)
        .set({
          model: ['command', 'webhook'].includes(cells.runtime.value)
            ? entry.row.model
            : cells.model.value,
          runtimePolicy: policy,
          ...(entry.overrides && { modelOverrides: entry.overrides }),
          ...(entry.role && { modelRole: entry.role }),
        })
        .where(
          and(eq(aiAgent.id, entry.row.id), eq(aiAgent.modelOverrides, entry.row.modelOverrides)),
        )
        .returning({ id: aiAgent.id });
      if (!updated.length) throw new HttpError(409, 'Agent settings changed during apply');
    }
  });
  return preview;
}
