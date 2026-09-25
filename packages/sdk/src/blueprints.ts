// Project blueprints as files (extension point "Vorlagen und Pakete", docs
// volition-helena-oss.md §3a: "Projekt- und Workflow-Vorlagen als Dateien"): everything a
// ready-to-work project needs besides its tasks — the project with its instructions and
// department, its areas, its agent team (copies of the agent templates a template bundle
// brings), the network rules of its agents, notes and note templates for its knowledge, a
// note board, its goals and the routines it proposes. Why it looks like this:
// docs/helena-decisions/trading.md §7 (the first blueprint is the trading project).
//
// A blueprint describes; it never carries a secret, a person or an id, so it can be shared.
// Applying one is idempotent: what exists is left alone (or reported where it differs),
// only what is missing is created, and routines are always created switched off — the owner
// switches them on. No I/O here; the directory form is read by @helena/sdk/server
// (blueprint-files.ts), and the API applies a blueprint through its own services.
//
// Directory form:
//   helena.blueprint.json   the manifest (everything below except the files)
//   instructions.md         the project-wide instructions of the agents (≤ 4000 characters)
//   knowledge/**            files placed below the project's knowledge folder Projects/<KEY>/
//   templates/**            note templates placed below the vault's Templates/ folder
//   boards/<name>.json      note boards: stickers and the arrows between them

import type { LocalizedText } from './text';

export const BLUEPRINT_FORMAT = 'helena.project-blueprint';
export const BLUEPRINT_FORMAT_VERSION = 1;
export const BLUEPRINT_MANIFEST = 'helena.blueprint.json';

export type BlueprintNetworkMode = 'open' | 'allowlist' | 'blocked';
export type BlueprintGoalStatus = 'planned' | 'active' | 'achieved' | 'paused';

export interface BlueprintAgent {
  // The agent template the project's agent is a copy of, by handle (a template of the team,
  // usually from the bundle named in `requires`). The copy is "<template>-<project key>".
  template: string;
  // What the agent does in this project: its assignment, shown in its SOUL.md (≤ 500).
  assignment: string;
  // Skills the copy gets on top of the template's.
  skills?: string[];
  // Its own network mode in the project, where it differs from the project's.
  network?: BlueprintNetworkMode;
  // Whether it browses in the project's browser (the browser gateway).
  projectBrowser?: boolean;
  // Connector tools bound to the team's credential of that connector, once the owner stored
  // one (configured tools): every tool of the connector, or the named ones.
  tools?: { connector: string; names?: string[] }[];
}

export interface BlueprintCoordinator {
  // Replaces the coordinator's generated default instructions (never an owner's own text).
  instructions?: string;
  skills?: string[];
  assignment?: string;
}

export interface BlueprintFile {
  // Relative to the folder the file goes to; ends in .md.
  path: string;
  content: string;
}

export interface BlueprintSticker {
  id: string;
  title: string;
  body: string;
  // A hex color or a JSON Canvas preset "1"–"6".
  color?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface BlueprintBoard {
  name: string;
  stickers: BlueprintSticker[];
  edges: { from: string; to: string }[];
}

export interface BlueprintGoal {
  title: string;
  description: string;
  status: BlueprintGoalStatus;
  targetDate?: string | null;
}

export interface BlueprintRoutine {
  // Stable within the blueprint; the routine's idempotency key is derived from it.
  key: string;
  title: string;
  // The agent it delegates to: a template handle of `agents`, or "coordinator".
  agent: string;
  instructions: string;
  // Five-field cron and its IANA time zone.
  cron: string;
  timezone: string;
  catchUp?: 'skip' | 'once';
}

export interface ProjectBlueprint {
  format: typeof BLUEPRINT_FORMAT;
  formatVersion: typeof BLUEPRINT_FORMAT_VERSION;
  // Kebab-case identifier, e.g. "trading".
  name: string;
  displayName: LocalizedText;
  version: string;
  description: string;
  license: string;
  author: { name: string; url?: string };
  // What has to be in the team first: template bundles by name.
  requires?: { bundles?: string[] };
  project: {
    key: string;
    name: string;
    description: string;
    // A department of the team, by name; the project joins it.
    department?: string;
    // The project-wide instructions of its agents.
    instructions: string;
  };
  areas: { name: string; folder?: string }[];
  coordinator?: BlueprintCoordinator;
  agents: BlueprintAgent[];
  // Added to the project's network settings; `mode` only where the project has none yet.
  network?: { mode?: BlueprintNetworkMode; allow?: string[]; deny?: string[] };
  knowledge: { project: BlueprintFile[]; templates: BlueprintFile[] };
  boards: BlueprintBoard[];
  goals: BlueprintGoal[];
  routines: BlueprintRoutine[];
}

const KEBAB = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HANDLE = /^[a-zA-Z0-9._-]{1,64}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const AREA_FOLDER = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_AREA_FOLDERS = new Set(['assets', 'boards', 'docs', 'files', 'inbox']);
const CRON = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODES: BlueprintNetworkMode[] = ['open', 'allowlist', 'blocked'];
const STATUSES: BlueprintGoalStatus[] = ['planned', 'active', 'achieved', 'paused'];

export const BLUEPRINT_LIMITS = {
  projectInstructions: 4000,
  assignment: 500,
  goalTitle: 160,
  goalDescription: 2000,
  routineTitle: 300,
  routineInstructions: 20_000,
  file: 200_000,
} as const;

// A relative path of plain segments that ends in .md: no "..", no hidden folder, no
// leading slash.
export function isBlueprintFilePath(path: string): boolean {
  if (!path.endsWith('.md') || path.startsWith('/') || path.includes('\\')) return false;
  return path
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '..' && !segment.startsWith('.'));
}

function checkFiles(where: string, files: BlueprintFile[], problems: string[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (!isBlueprintFilePath(file.path))
      problems.push(`${where} ${file.path}: not a plain .md path`);
    if (seen.has(file.path.toLowerCase())) problems.push(`${where} ${file.path}: listed twice`);
    seen.add(file.path.toLowerCase());
    if (!file.content.trim()) problems.push(`${where} ${file.path}: empty`);
    if (file.content.length > BLUEPRINT_LIMITS.file)
      problems.push(`${where} ${file.path}: too large`);
  }
}

// Everything wrong with a blueprint, as readable lines. An empty list means it is valid.
export function validateBlueprint(blueprint: ProjectBlueprint): string[] {
  const problems: string[] = [];
  if (blueprint.format !== BLUEPRINT_FORMAT) problems.push(`format is not ${BLUEPRINT_FORMAT}`);
  if (blueprint.formatVersion !== BLUEPRINT_FORMAT_VERSION)
    problems.push(`formatVersion is not ${BLUEPRINT_FORMAT_VERSION}`);
  if (!KEBAB.test(blueprint.name ?? '')) problems.push('name is not kebab-case');
  for (const field of ['version', 'description', 'license'] as const) {
    if (!blueprint[field]?.trim()) problems.push(`${field} is empty`);
  }

  const { project } = blueprint;
  if (!PROJECT_KEY.test(project?.key ?? '')) problems.push('project.key is not a project key');
  if (!project?.name?.trim()) problems.push('project.name is empty');
  if (!project?.instructions?.trim()) problems.push('project.instructions are empty');
  if ((project?.instructions?.length ?? 0) > BLUEPRINT_LIMITS.projectInstructions)
    problems.push(`project.instructions exceed ${BLUEPRINT_LIMITS.projectInstructions} characters`);

  const folders = new Set<string>();
  for (const area of blueprint.areas) {
    if (!area.name?.trim()) problems.push('an area has no name');
    if (area.folder !== undefined) {
      if (!AREA_FOLDER.test(area.folder) || area.folder.length > 64)
        problems.push(`area ${area.name}: folder ${area.folder}`);
      if (RESERVED_AREA_FOLDERS.has(area.folder))
        problems.push(`area ${area.name}: folder ${area.folder} is reserved`);
      if (folders.has(area.folder)) problems.push(`area ${area.name}: folder listed twice`);
      folders.add(area.folder);
    }
  }

  const templates = new Set<string>();
  for (const agent of blueprint.agents) {
    const where = `agent ${agent.template}`;
    if (!HANDLE.test(agent.template)) problems.push(`${where}: template is not a handle`);
    if (templates.has(agent.template.toLowerCase())) problems.push(`${where}: listed twice`);
    templates.add(agent.template.toLowerCase());
    if (!agent.assignment?.trim()) problems.push(`${where}: no assignment`);
    if (agent.assignment.length > BLUEPRINT_LIMITS.assignment)
      problems.push(`${where}: assignment exceeds ${BLUEPRINT_LIMITS.assignment} characters`);
    if (agent.network !== undefined && !MODES.includes(agent.network))
      problems.push(`${where}: network ${String(agent.network)}`);
    for (const skill of agent.skills ?? []) {
      if (!KEBAB.test(skill)) problems.push(`${where}: skill ${skill}`);
    }
    for (const binding of agent.tools ?? []) {
      if (!binding.connector?.trim()) problems.push(`${where}: a tool binding names no connector`);
    }
  }
  const coordinator = blueprint.coordinator;
  if (coordinator?.assignment && coordinator.assignment.length > BLUEPRINT_LIMITS.assignment)
    problems.push(`coordinator: assignment exceeds ${BLUEPRINT_LIMITS.assignment} characters`);
  for (const skill of coordinator?.skills ?? []) {
    if (!KEBAB.test(skill)) problems.push(`coordinator: skill ${skill}`);
  }

  if (blueprint.network?.mode !== undefined && !MODES.includes(blueprint.network.mode))
    problems.push(`network.mode ${String(blueprint.network.mode)}`);

  checkFiles('knowledge', blueprint.knowledge.project, problems);
  checkFiles('template', blueprint.knowledge.templates, problems);

  const boards = new Set<string>();
  for (const board of blueprint.boards) {
    if (!board.name?.trim()) problems.push('a board has no name');
    if (boards.has(board.name)) problems.push(`board ${board.name}: listed twice`);
    boards.add(board.name);
    const ids = new Set(board.stickers.map((sticker) => sticker.id));
    if (ids.size !== board.stickers.length)
      problems.push(`board ${board.name}: sticker ids repeat`);
    for (const edge of board.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to))
        problems.push(`board ${board.name}: an arrow ${edge.from} → ${edge.to} has no sticker`);
    }
  }

  const goals = new Set<string>();
  for (const goal of blueprint.goals) {
    const where = `goal "${goal.title}"`;
    if (!goal.title?.trim() || goal.title.length > BLUEPRINT_LIMITS.goalTitle)
      problems.push(`${where}: title`);
    if (goal.description.length > BLUEPRINT_LIMITS.goalDescription)
      problems.push(`${where}: description too long`);
    if (!STATUSES.includes(goal.status)) problems.push(`${where}: status ${String(goal.status)}`);
    if (goal.targetDate && !DATE.test(goal.targetDate)) problems.push(`${where}: targetDate`);
    if (goals.has(goal.title)) problems.push(`${where}: listed twice`);
    goals.add(goal.title);
  }

  const routines = new Set<string>();
  for (const routine of blueprint.routines) {
    const where = `routine ${routine.key}`;
    if (!KEBAB.test(routine.key)) problems.push(`${where}: key is not kebab-case`);
    if (routines.has(routine.key)) problems.push(`${where}: listed twice`);
    routines.add(routine.key);
    if (!routine.title?.trim() || routine.title.length > BLUEPRINT_LIMITS.routineTitle)
      problems.push(`${where}: title`);
    if (
      !routine.instructions?.trim() ||
      routine.instructions.length > BLUEPRINT_LIMITS.routineInstructions
    )
      problems.push(`${where}: instructions`);
    if (!CRON.test(routine.cron.trim())) problems.push(`${where}: cron is not five fields`);
    if (!routine.timezone?.trim()) problems.push(`${where}: no time zone`);
    if (routine.agent !== 'coordinator' && !templates.has(routine.agent.toLowerCase()))
      problems.push(`${where}: agent ${routine.agent} is not one of the blueprint's agents`);
  }
  return problems;
}

// A blueprint from JSON of unknown origin: checked before anything uses it.
export function parseBlueprintJson(text: string): ProjectBlueprint {
  const blueprint = JSON.parse(text) as ProjectBlueprint;
  if (!blueprint || typeof blueprint !== 'object' || !blueprint.project) {
    throw new Error('Not a Helena project blueprint');
  }
  const problems = validateBlueprint(blueprint);
  if (problems.length > 0) throw new Error(`Invalid blueprint:\n- ${problems.join('\n- ')}`);
  return blueprint;
}

// The handle a template's copy gets in a project (as copyTemplateIntoProject names it).
export function blueprintCopyHandle(template: string, projectKey: string): string {
  const suffix = `-${projectKey.toLowerCase()}`;
  return template.slice(0, 64 - suffix.length) + suffix;
}
