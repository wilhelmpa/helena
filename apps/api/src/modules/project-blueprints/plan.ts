import { createHash } from 'node:crypto';
import {
  blueprintCopyHandle,
  type BlueprintNetworkMode,
  type BlueprintSticker,
  type ProjectBlueprint,
} from '@helena/sdk';
import { hermesProjectCoordinatorUsername } from '@repo/agent-naming';

// What applying a project blueprint (@helena/sdk blueprints.ts) changes, worked out from the
// team as it is. Pure: the state comes from state.ts, the changes are carried out by
// apply.ts through Helena's own services. Everything here only adds: what exists is left as
// it is, and where it differs from the blueprint that is reported, never overwritten. Agents
// are named by handle, never by id, so a plan for a project that does not exist yet reads
// the same as one for a project half set up.

export const BLUEPRINT_SECTIONS = [
  'project',
  'areas',
  'agents',
  'network',
  'knowledge',
  'goals',
  'routines',
  'tools',
  'report',
] as const;
export type BlueprintSection = (typeof BLUEPRINT_SECTIONS)[number];
// Tool bindings wait for the owner's credential, and are applied on request once it exists.
export const DEFAULT_BLUEPRINT_SECTIONS: BlueprintSection[] = BLUEPRINT_SECTIONS.filter(
  (section) => section !== 'tools',
);

export interface StateAgent {
  id: number;
  userId: string;
  username: string;
  template: boolean;
  sourceTemplateId: number | null;
  instructions: string | null;
  skills: string[];
  projectKeys: string[];
  // Its assignment in the blueprint's project, or null when it does not work there.
  assignment: string | null;
  departmentId: number | null;
  projectBrowser: boolean;
  memoryApproval: boolean;
  // The configured tools enabled on it.
  tools: { agentToolId: number; toolKey: string; credentialId: number }[];
}

export interface BlueprintState {
  departments: { id: number; name: string }[];
  project: {
    id: number;
    key: string;
    name: string;
    departmentId: number | null;
    instructions: string;
  } | null;
  areas: { name: string; folder: string }[];
  agents: StateAgent[];
  // Skill names of the team's library.
  library: string[];
  // The project's network settings, and whether it has settings of its own yet.
  network: {
    stored: boolean;
    mode: BlueprintNetworkMode;
    allow: string[];
    deny: string[];
    agents: Record<string, BlueprintNetworkMode>;
  } | null;
  // The vault paths of the blueprint's files that exist already.
  existingFiles: string[];
  boards: string[];
  goals: { title: string; projectId: number | null }[];
  // The idempotency keys of the project's routines.
  routineKeys: string[];
  // The team's credentials of the connectors the blueprint binds tools of.
  credentials: { id: number; kind: string; label: string }[];
  // The team's configured tools.
  agentTools: { id: number; toolKey: string; credentialId: number }[];
  // The tools each connector has (the registry).
  connectorTools: Record<string, string[]>;
  // The instructions Helena gives a new coordinator, which the blueprint may replace.
  defaultCoordinatorInstructions: string;
}

export type Change =
  | { kind: 'project'; key: string; name: string; description: string }
  | { kind: 'projectDepartment'; department: string; departmentId: number }
  | { kind: 'projectInstructions'; to: string }
  | { kind: 'area'; name: string; folder: string | undefined }
  | { kind: 'coordinatorInstructions'; handle: string; to: string }
  | { kind: 'copy'; template: string; handle: string }
  | { kind: 'skills'; handle: string; add: string[] }
  | { kind: 'assignment'; handle: string; to: string }
  | { kind: 'department'; handle: string; department: string; departmentId: number }
  | { kind: 'projectBrowser'; handle: string }
  | {
      kind: 'network';
      mode: BlueprintNetworkMode | null;
      addAllow: string[];
      addDeny: string[];
      agents: Record<string, BlueprintNetworkMode>;
    }
  | { kind: 'file'; path: string; content: string }
  | {
      kind: 'board';
      name: string;
      stickers: BlueprintSticker[];
      edges: { from: string; to: string }[];
    }
  | {
      kind: 'goal';
      title: string;
      description: string;
      status: ProjectBlueprint['goals'][number]['status'];
      targetDate: string | null;
      department: string | null;
      departmentId: number | null;
    }
  | {
      kind: 'routine';
      key: string;
      idempotencyKey: string;
      title: string;
      handle: string;
      instructions: string;
      cron: string;
      timezone: string;
      catchUp: 'skip' | 'once';
    }
  | {
      kind: 'tools';
      handle: string;
      connector: string;
      credentialId: number;
      credentialLabel: string;
      toolKeys: string[];
    };

export interface Skipped {
  what: string;
  why: string;
}

export interface BlueprintPlan {
  changes: Change[];
  skipped: Skipped[];
  // What has to happen before the plan can be applied in full (a template missing …).
  blockers: string[];
}

export function coordinatorHandle(projectKey: string): string {
  return hermesProjectCoordinatorUsername(projectKey);
}

// A stable UUID (version 5 layout, SHA-1) for a routine of a blueprint in a project, so
// applying the blueprint again finds the routine it created.
export function routineIdempotencyKey(blueprint: string, projectKey: string, key: string): string {
  const bytes = createHash('sha1')
    .update(`helena-blueprint:${blueprint}:${projectKey}:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function projectFilePath(projectKey: string, path: string): string {
  return `Projects/${projectKey}/${path}`;
}

export function templateFilePath(path: string): string {
  return `Templates/${path}`;
}

const byHandle = (agents: StateAgent[], handle: string) =>
  agents.find((agent) => agent.username.toLowerCase() === handle.toLowerCase());

const sameText = (a: string | null | undefined, b: string) => (a ?? '').trim() === b.trim();

export function planBlueprint(
  blueprint: ProjectBlueprint,
  state: BlueprintState,
  sections: readonly BlueprintSection[],
): BlueprintPlan {
  const plan: BlueprintPlan = { changes: [], skipped: [], blockers: [] };
  const on = (section: BlueprintSection) => sections.includes(section);
  const key = blueprint.project.key;
  const department = blueprint.project.department
    ? state.departments.find((entry) => entry.name === blueprint.project.department)
    : undefined;
  if (blueprint.project.department && !department) {
    plan.skipped.push({
      what: `department "${blueprint.project.department}"`,
      why: 'not in the team; the project and its agents stay without a department',
    });
  }

  // ── The project ─────────────────────────────────────────────────────────────────────────
  if (on('project')) {
    if (!state.project) {
      plan.changes.push({
        kind: 'project',
        key,
        name: blueprint.project.name,
        description: blueprint.project.description,
      });
    } else if (state.project.name !== blueprint.project.name) {
      plan.skipped.push({
        what: `project ${key}`,
        why: `exists as "${state.project.name}"; name left as it is`,
      });
    }
    if (department && state.project?.departmentId !== department.id) {
      if (state.project?.departmentId) {
        plan.skipped.push({ what: `department of ${key}`, why: 'set to another one by hand' });
      } else {
        plan.changes.push({
          kind: 'projectDepartment',
          department: department.name,
          departmentId: department.id,
        });
      }
    }
    const current = state.project?.instructions ?? '';
    if (!current.trim()) {
      plan.changes.push({ kind: 'projectInstructions', to: blueprint.project.instructions });
    } else if (!sameText(current, blueprint.project.instructions)) {
      plan.skipped.push({
        what: `project instructions of ${key}`,
        why: 'someone wrote their own; left as they are (the blueprint text is in instructions.md)',
      });
    }
  }

  // ── Areas ───────────────────────────────────────────────────────────────────────────────
  if (on('areas')) {
    for (const area of blueprint.areas) {
      const exists = state.areas.some(
        (entry) =>
          entry.name.toLowerCase() === area.name.toLowerCase() ||
          (area.folder !== undefined && entry.folder === area.folder),
      );
      if (!exists) plan.changes.push({ kind: 'area', name: area.name, folder: area.folder });
    }
  }

  // ── The agent team ──────────────────────────────────────────────────────────────────────
  const coordinator = coordinatorHandle(key);
  const handleOf = (template: string) =>
    template === 'coordinator' ? coordinator : blueprintCopyHandle(template, key);
  if (on('agents')) {
    const current = byHandle(state.agents, coordinator);
    const wanted = blueprint.coordinator;
    if (wanted?.instructions) {
      if (
        !current ||
        !current.instructions?.trim() ||
        sameText(current.instructions, state.defaultCoordinatorInstructions)
      ) {
        plan.changes.push({
          kind: 'coordinatorInstructions',
          handle: coordinator,
          to: wanted.instructions,
        });
      } else if (!sameText(current.instructions, wanted.instructions)) {
        plan.skipped.push({
          what: `instructions of @${coordinator}`,
          why: 'someone wrote their own; left as they are',
        });
      }
    }
    addSkills(plan, state, coordinator, current?.skills ?? [], wanted?.skills ?? []);
    if (wanted?.assignment)
      assign(plan, coordinator, current?.assignment ?? null, wanted.assignment, !current);
    if (department) setDepartment(plan, coordinator, current, department);

    for (const agent of blueprint.agents) {
      const handle = handleOf(agent.template);
      const template = byHandle(state.agents, agent.template);
      const copy = byHandle(state.agents, handle);
      if (!copy) {
        if (!template?.template) {
          plan.blockers.push(
            `@${agent.template} is not an agent template of the team: import ` +
              `${blueprint.requires?.bundles?.join(', ') || 'its bundle'} first (Vorlagen importieren).`,
          );
          continue;
        }
        plan.changes.push({ kind: 'copy', template: agent.template, handle });
      } else if (copy.template || !copy.projectKeys.includes(key)) {
        plan.skipped.push({
          what: `@${handle}`,
          why: copy.template ? 'is a template, not a copy' : `works outside ${key}; left alone`,
        });
        continue;
      }
      const skills = copy ? copy.skills : (template?.skills ?? []);
      addSkills(plan, state, handle, skills, agent.skills ?? []);
      assign(plan, handle, copy?.assignment ?? null, agent.assignment, !copy);
      if (department) setDepartment(plan, handle, copy, department);
      if (agent.projectBrowser && !copy?.projectBrowser) {
        plan.changes.push({ kind: 'projectBrowser', handle });
      }
      if (copy && !copy.memoryApproval) {
        plan.skipped.push({
          what: `memory approval of @${handle}`,
          why: 'switched off by hand; the blueprint wants it on — check the agent',
        });
      }
    }
  }

  // ── Network ─────────────────────────────────────────────────────────────────────────────
  if (on('network') && blueprint.network) {
    const network = state.network;
    const allow = blueprint.network.allow ?? [];
    const deny = blueprint.network.deny ?? [];
    const addAllow = allow.filter((host) => !network?.allow.includes(host));
    const addDeny = deny.filter((host) => !network?.deny.includes(host));
    const mode =
      blueprint.network.mode && (!network || !network.stored) ? blueprint.network.mode : null;
    const agents: Record<string, BlueprintNetworkMode> = {};
    for (const agent of blueprint.agents) {
      if (!agent.network) continue;
      const handle = handleOf(agent.template);
      const copy = byHandle(state.agents, handle);
      const currentMode = copy ? network?.agents[String(copy.id)] : undefined;
      if (currentMode === undefined) agents[handle] = agent.network;
      else if (currentMode !== agent.network) {
        plan.skipped.push({
          what: `network of @${handle}`,
          why: `set to ${currentMode} by hand; the blueprint says ${agent.network}`,
        });
      }
    }
    if (addAllow.length || addDeny.length || mode || Object.keys(agents).length) {
      plan.changes.push({ kind: 'network', mode, addAllow, addDeny, agents });
    }
  }

  // ── Knowledge: notes, templates, the board ──────────────────────────────────────────────
  if (on('knowledge')) {
    const existing = new Set(state.existingFiles);
    for (const file of blueprint.knowledge.project) {
      const path = projectFilePath(key, file.path);
      if (!existing.has(path)) plan.changes.push({ kind: 'file', path, content: file.content });
    }
    for (const file of blueprint.knowledge.templates) {
      const path = templateFilePath(file.path);
      if (!existing.has(path)) plan.changes.push({ kind: 'file', path, content: file.content });
    }
    for (const board of blueprint.boards) {
      if (!state.boards.includes(board.name)) {
        plan.changes.push({
          kind: 'board',
          name: board.name,
          stickers: board.stickers,
          edges: board.edges,
        });
      }
    }
  }

  // ── Goals ───────────────────────────────────────────────────────────────────────────────
  if (on('goals')) {
    for (const goal of blueprint.goals) {
      const exists = state.goals.some(
        (entry) =>
          entry.title === goal.title &&
          (entry.projectId === null || entry.projectId === (state.project?.id ?? -1)),
      );
      if (exists) continue;
      plan.changes.push({
        kind: 'goal',
        title: goal.title,
        description: goal.description,
        status: goal.status,
        targetDate: goal.targetDate ?? null,
        department: department?.name ?? null,
        departmentId: department?.id ?? null,
      });
    }
  }

  // ── Routines (always switched off) ──────────────────────────────────────────────────────
  if (on('routines')) {
    const existing = new Set(state.routineKeys.map((entry) => entry.toLowerCase()));
    for (const routine of blueprint.routines) {
      const idempotencyKey = routineIdempotencyKey(blueprint.name, key, routine.key);
      if (existing.has(idempotencyKey)) continue;
      plan.changes.push({
        kind: 'routine',
        key: routine.key,
        idempotencyKey,
        title: routine.title,
        handle: handleOf(routine.agent),
        instructions: routine.instructions,
        cron: routine.cron,
        timezone: routine.timezone,
        catchUp: routine.catchUp ?? 'skip',
      });
    }
  }

  // ── Connector tools bound to the owner's credential ─────────────────────────────────────
  if (on('tools')) {
    for (const agent of blueprint.agents) {
      const handle = handleOf(agent.template);
      const copy = byHandle(state.agents, handle);
      for (const binding of agent.tools ?? []) {
        const credentials = state.credentials.filter((entry) => entry.kind === binding.connector);
        if (credentials.length === 0) {
          plan.skipped.push({
            what: `${binding.connector} tools of @${handle}`,
            why: `no ${binding.connector} credential yet (the owner stores it under Integrationen)`,
          });
          continue;
        }
        if (credentials.length > 1) {
          plan.skipped.push({
            what: `${binding.connector} tools of @${handle}`,
            why: `${credentials.length} ${binding.connector} credentials; bind the right one by hand`,
          });
          continue;
        }
        const credential = credentials[0]!;
        const wanted = binding.names ?? state.connectorTools[binding.connector] ?? [];
        const have = new Set(
          (copy?.tools ?? [])
            .filter((tool) => tool.credentialId === credential.id)
            .map((tool) => tool.toolKey),
        );
        const toolKeys = wanted.filter((name) => !have.has(name));
        if (toolKeys.length > 0) {
          plan.changes.push({
            kind: 'tools',
            handle,
            connector: binding.connector,
            credentialId: credential.id,
            credentialLabel: credential.label,
            toolKeys,
          });
        }
      }
    }
  }
  return plan;
}

function addSkills(
  plan: BlueprintPlan,
  state: BlueprintState,
  handle: string,
  have: string[],
  wanted: string[],
): void {
  const missing = wanted.filter((skill) => !have.includes(skill));
  const known = missing.filter((skill) => state.library.includes(skill));
  const unknown = missing.filter((skill) => !state.library.includes(skill));
  if (unknown.length > 0) {
    plan.skipped.push({
      what: `skills of @${handle}: ${unknown.join(', ')}`,
      why: 'not in the skill library; import the bundle first',
    });
  }
  if (known.length > 0) plan.changes.push({ kind: 'skills', handle, add: known });
}

function assign(
  plan: BlueprintPlan,
  handle: string,
  current: string | null,
  wanted: string,
  isNew: boolean,
): void {
  if (isNew || !current?.trim()) plan.changes.push({ kind: 'assignment', handle, to: wanted });
  else if (!sameText(current, wanted)) {
    plan.skipped.push({ what: `assignment of @${handle}`, why: 'written by hand; left as it is' });
  }
}

function setDepartment(
  plan: BlueprintPlan,
  handle: string,
  agent: StateAgent | undefined,
  department: { id: number; name: string },
): void {
  if (agent?.departmentId === department.id) return;
  if (agent?.departmentId) {
    plan.skipped.push({ what: `department of @${handle}`, why: 'set to another one by hand' });
    return;
  }
  plan.changes.push({
    kind: 'department',
    handle,
    department: department.name,
    departmentId: department.id,
  });
}

// The plan as lines a person reads (the dry run prints them).
export function formatPlan(plan: BlueprintPlan): string[] {
  const lines: string[] = [];
  for (const blocker of plan.blockers) lines.push(`[BLOCKED] ${blocker}`);
  for (const change of plan.changes) lines.push(describeChange(change));
  for (const skipped of plan.skipped) lines.push(`[LEFT] ${skipped.what}: ${skipped.why}`);
  return lines;
}

export function describeChange(change: Change): string {
  switch (change.kind) {
    case 'project':
      return `[PROJECT] create ${change.key} "${change.name}"`;
    case 'projectDepartment':
      return `[PROJECT] department "${change.department}"`;
    case 'projectInstructions':
      return `[PROJECT] project instructions (${change.to.length} characters)`;
    case 'area':
      return `[AREA] "${change.name}"${change.folder ? ` (${change.folder}/)` : ''}`;
    case 'coordinatorInstructions':
      return `[AGENT] @${change.handle}: instructions (${change.to.length} characters)`;
    case 'copy':
      return `[AGENT] copy @${change.template} into the project as @${change.handle}`;
    case 'skills':
      return `[AGENT] @${change.handle}: + skills ${change.add.join(', ')}`;
    case 'assignment':
      return `[AGENT] @${change.handle}: assignment "${change.to.slice(0, 80)}${change.to.length > 80 ? '…' : ''}"`;
    case 'department':
      return `[AGENT] @${change.handle}: department "${change.department}"`;
    case 'projectBrowser':
      return `[AGENT] @${change.handle}: project browser`;
    case 'network': {
      const parts = [
        ...(change.mode ? [`mode ${change.mode}`] : []),
        ...(change.addDeny.length ? [`+ ${change.addDeny.length} denied hosts`] : []),
        ...(change.addAllow.length ? [`+ allowed ${change.addAllow.join(', ')}`] : []),
        ...Object.entries(change.agents).map(([handle, mode]) => `@${handle} ${mode}`),
      ];
      return `[NETWORK] ${parts.join('; ')}`;
    }
    case 'file':
      return `[FILE] ${change.path}`;
    case 'board':
      return `[BOARD] "${change.name}" (${change.stickers.length} stickers)`;
    case 'goal':
      return `[GOAL] "${change.title}" (${change.status})`;
    case 'routine':
      return `[ROUTINE] "${change.title}" → @${change.handle}, ${change.cron} ${change.timezone}, switched off`;
    case 'tools':
      return `[TOOLS] @${change.handle}: ${change.toolKeys.join(', ')} with "${change.credentialLabel}"`;
  }
}
