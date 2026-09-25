// What it takes to bring the running Hermes agents to a target configuration, and what the
// audit reads off their runtime state: pure functions over plain data, so the planning is
// tested without a database. agent-tuning.ts loads the state and applies the plan.
//
// The rules that keep it safe to run again and again:
// - Skills, denied toolsets and disabled Hermes skills are only ever added, except a Helena
//   skill whose name a skill that shipped with Hermes already has in the agent's profile:
//   Hermes refuses to pick between two different skills of one name (skill_view answers
//   "Ambiguous skill name"), so that link goes and the Hermes copy serves.
// - A text (instructions, SOUL.md, project instructions, an agent's assignment in a
//   project) replaces only an empty field or a text this tuning wrote or the audit saw; one
//   the owner wrote since is left alone and reported.
// - A model, a reasoning level or triggers are set only where the agent has none of its own.
// - Only running Hermes agents are tuned, and the pool templates their copies come from:
//   no Claude Code or Codex agent.
// - A copy the plan creates is planned as if it existed already (projectState), so a dry run
//   shows everything it gets, and one run creates and tunes it.

import { createHash } from 'node:crypto';

export interface TextTarget {
  text: string;
  // SHA-256 of the texts this one may replace. An empty field is always replaced.
  replaces: string[];
  // A copy's instructions: replaces them while they are still its template's.
  overTemplate?: boolean;
}

// A text that names the agents of a team: rendered from those of `candidates` that work in
// `project` (a copy the same run creates included), so it follows the team as it grows. Any
// text it rendered for another set of them may be replaced as well.
export interface TeamText {
  project: string;
  candidates: string[];
  render: (present: string[]) => string;
  replaces: string[];
}

export interface AgentTarget {
  username: string;
  // A project copy of a pool template, which the section `copies` creates when it is missing.
  copyOf?: { template: string; projectKey: string };
  // Skills of the team's library the agent should have, by name.
  addSkills: string[];
  // Skills to unlink, by name.
  removeSkills?: string[];
  // Hermes toolsets turned off for the agent (runtime policy toolDeny).
  denyToolsets: string[];
  // Skills of the runtime turned off by name (runtime policy skillsDisabled).
  disableSkills: string[];
  instructions?: TextTarget | TeamText;
  // The agent's own SOUL.md (the first block of the SOUL.md Helena writes).
  soul?: TextTarget;
  // Section `reasoning`: the model and the reasoning effort.
  model?: string;
  reasoning?: string;
  // Section `browser`: the project browser ("Projekt-Browser").
  projectBrowser?: boolean;
  // Section `copies`: that a mention and a delegation start a run of it, the name it is shown
  // by (a copy's is "<template name> <KEY>" until then), and its place in the organisation:
  // its department (by name), its agent-team role and whom it reports to (by username).
  triggers?: { mention: boolean; assign: boolean };
  name?: string;
  org?: { department?: string; role?: 'specialist' | 'reviewer'; reportsTo?: string };
  // The agent's assignment in a project (the project member description), by project key.
  assignments?: Record<string, TextTarget>;
}

// A pool template whose copies the tuning creates: what every copy of it should have too.
export interface TemplateTarget {
  username: string;
  denyToolsets: string[];
}

export interface ProjectTarget {
  key: string;
  // The project-wide instructions every agent of the project reads.
  instructions: TextTarget;
}

// A department of the organisation the section `copies` creates, below its parent department.
export interface DepartmentTarget {
  name: string;
  parent: string | null;
  description: string;
}

export interface TuningTarget {
  projects: ProjectTarget[];
  agents: AgentTarget[];
  templates?: TemplateTarget[];
  departments?: DepartmentTarget[];
}

export const SECTIONS = [
  'skills',
  'tools',
  'instructions',
  'projects',
  'copies',
  'browser',
  'reasoning',
  'report',
] as const;
export type Section = (typeof SECTIONS)[number];
// New agents, the project browser and models are the owner's call: only on request.
export const DEFAULT_SECTIONS: Section[] = [
  'skills',
  'tools',
  'instructions',
  'projects',
  'report',
];

// The API's own bounds (organization/model.ts), which a text written here keeps as well, so
// the owner can still save it from Helena.
export const PROJECT_INSTRUCTIONS_MAX = 4000;
export const ASSIGNMENT_MAX = 500;
const NAME_MAX = 128;
// A team text is checked against every set of its candidates it could have rendered.
const TEAM_CANDIDATES_MAX = 10;

// ── Current state ──────────────────────────────────────────────────────────────────────

export interface InventorySkill {
  name: string;
  origin: 'bundled' | 'hub' | 'plan' | 'agent';
}

export interface InventoryMemory {
  file: 'MEMORY.md' | 'USER.md';
  chars: number;
}

export interface CurrentAgent {
  id: number;
  username: string;
  template: boolean;
  // The name it is shown by.
  name: string;
  // The template the agent is a copy of, by username; null for any other agent.
  copyOf: string | null;
  // 'hermes', 'claude' or 'codex'.
  runtime: string;
  model: string | null;
  instructions: string | null;
  soul: string | null;
  toolDeny: string[];
  skillsDisabled: string[];
  reasoningEffort: string | null;
  // Linked skills of the library, by name.
  skills: string[];
  // Whether the project browser is on, or the old Hermes browser someone chose instead.
  browser: 'gateway' | 'legacy' | 'none';
  projects: { id: number; key: string; assignment: string }[];
  // The agent's place in the organisation: its agent-team role and whom it reports to.
  role: string | null;
  manager: string | null;
  department: string | null;
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
  // What the runner last read from the agent's Hermes home; null before it reported one.
  inventory: { skills: InventorySkill[]; memory: InventoryMemory[] } | null;
  status: string;
  drift: { key: string; code: string }[];
  learnedSkills: number;
  pendingMemoryProposals: number;
  reflections: { total: number; saved: number; failed: number };
}

export interface CurrentProject {
  id: number;
  key: string;
  instructions: string;
  // The project's coordinator, by username.
  coordinator: string | null;
}

export interface CurrentState {
  agents: CurrentAgent[];
  projects: CurrentProject[];
  // The names of the team's skill library.
  library: string[];
  // Models the provider refused for Hermes (helena_model_availability), which no agent is set to.
  unavailableModels: string[];
  departments: { id: number; name: string; parent: string | null }[];
}

// ── The plan ───────────────────────────────────────────────────────────────────────────

interface AgentRef {
  agentId: number;
  username: string;
}

export type Change =
  | (AgentRef & {
      kind: 'skills';
      add: string[];
      remove: { name: string; why: 'target' | 'bundled-duplicate' }[];
    })
  | (AgentRef & { kind: 'toolDeny' | 'skillsDisabled' | 'templateToolDeny'; add: string[] })
  | (AgentRef & { kind: 'instructions' | 'soul'; from: string; to: string })
  | (AgentRef & { kind: 'reasoning' | 'model'; from: string | null; to: string })
  | (AgentRef & { kind: 'browser' })
  | (AgentRef & { kind: 'triggers'; mention: boolean; assign: boolean })
  | (AgentRef & { kind: 'name'; from: string; to: string })
  | (AgentRef & {
      kind: 'org';
      department?: { from: string | null; to: string };
      role?: { from: string | null; to: string };
      reportsTo?: { from: string | null; to: string };
    })
  | { kind: 'department'; name: string; parent: string | null; description: string }
  | (AgentRef & {
      kind: 'assignment';
      projectId: number;
      projectKey: string;
      from: string;
      to: string;
    })
  | {
      kind: 'copy';
      templateId: number;
      template: string;
      projectId: number;
      projectKey: string;
      username: string;
      // The template's model, or null when the provider refused it (the copy then runs on
      // its runtime's default, as copyTemplateIntoProject does).
      model: string | null;
      modelRefused: boolean;
    }
  | {
      kind: 'projectInstructions';
      projectId: number;
      projectKey: string;
      from: string;
      to: string;
    };

export interface Plan {
  changes: Change[];
  // What the plan leaves alone and why.
  skipped: string[];
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// The handle of a template's copy in a project (copyTemplateIntoProject).
export function copyHandle(template: string, projectKey: string): string {
  const suffix = `-${projectKey.toLowerCase()}`;
  return `${template.slice(0, 64 - suffix.length)}${suffix}`;
}

// Whether `target` may replace `current`: the same text needs nothing, an empty one or one
// the target names is replaced, anything else is the owner's.
export function textDecision(
  current: string | null | undefined,
  target: TextTarget,
): 'same' | 'replace' | 'owned' {
  const value = current?.trim() ?? '';
  if (value === target.text.trim()) return 'same';
  if (!value || target.replaces.includes(sha256(current ?? ''))) return 'replace';
  return 'owned';
}

function subsets<T>(items: T[]): T[][] {
  return items.reduce<T[][]>((all, item) => [...all, ...all.map((set) => [...set, item])], [[]]);
}

// A team text as the text it is for this state: the candidates that work in its project,
// and every text it could have rendered before as its own.
export function resolveText(text: TextTarget | TeamText, state: CurrentState): TextTarget {
  if (!('render' in text)) return text;
  const members = new Set(
    state.agents
      .filter((agent) => !agent.template && agent.projects.some((p) => p.key === text.project))
      .map((agent) => agent.username),
  );
  return {
    text: text.render(text.candidates.filter((name) => members.has(name))),
    replaces: [
      ...text.replaces,
      ...subsets(text.candidates).map((set) => sha256(text.render(set).trim())),
    ],
  };
}

// Everything wrong with a target before it meets any agent.
export function validateTarget(target: TuningTarget): string[] {
  const problems: string[] = [];
  for (const project of target.projects) {
    if (project.instructions.text.trim().length > PROJECT_INSTRUCTIONS_MAX) {
      problems.push(`${project.key}: project instructions longer than ${PROJECT_INSTRUCTIONS_MAX}`);
    }
  }
  const seen = new Set<string>();
  for (const agent of target.agents) {
    if (seen.has(agent.username)) problems.push(`@${agent.username} is named twice`);
    seen.add(agent.username);
    const disabled = new Set(agent.disableSkills);
    for (const name of [...agent.addSkills, ...agent.disableSkills, ...agent.denyToolsets]) {
      if (!name.trim() || name.length > NAME_MAX)
        problems.push(`@${agent.username}: name "${name}"`);
    }
    for (const name of agent.addSkills) {
      if (disabled.has(name)) problems.push(`@${agent.username}: ${name} is added and disabled`);
    }
    for (const [key, text] of Object.entries(agent.assignments ?? {})) {
      if (text.text.trim().length > ASSIGNMENT_MAX) {
        problems.push(`@${agent.username} in ${key}: assignment longer than ${ASSIGNMENT_MAX}`);
      }
    }
    if (agent.copyOf) {
      const handle = copyHandle(agent.copyOf.template, agent.copyOf.projectKey);
      if (handle !== agent.username)
        problems.push(`@${agent.username}: a copy of ${agent.copyOf.template} is @${handle}`);
    }
    const team = agent.instructions && 'render' in agent.instructions ? agent.instructions : null;
    if (team && team.candidates.length > TEAM_CANDIDATES_MAX) {
      problems.push(`@${agent.username}: more than ${TEAM_CANDIDATES_MAX} team candidates`);
    }
  }
  return problems;
}

const unique = (items: string[]) => [...new Set(items)];

// The state as it is once the changes are made: what a dry run plans the rest against, and
// what a second run finds. A copy is an agent of its own with the template's configuration,
// in its project, reporting to the project's coordinator; its id is negative until it exists.
export function projectState(state: CurrentState, changes: Change[]): CurrentState {
  const next: CurrentState = structuredClone(state);
  const find = (id: number) => next.agents.find((agent) => agent.id === id);
  let newId = 0;
  for (const change of changes) {
    if (change.kind === 'projectInstructions') {
      const project = next.projects.find((p) => p.id === change.projectId);
      if (project) project.instructions = change.to;
      continue;
    }
    if (change.kind === 'department') {
      next.departments.push({ id: --newId, name: change.name, parent: change.parent });
      continue;
    }
    if (change.kind === 'copy') {
      const template = find(change.templateId);
      if (!template) continue;
      next.agents.push({
        ...structuredClone(template),
        id: --newId,
        username: change.username,
        name: `${template.name} ${change.projectKey}`,
        template: false,
        copyOf: template.username,
        model: change.model,
        reasoningEffort: change.modelRefused ? null : template.reasoningEffort,
        projects: [{ id: change.projectId, key: change.projectKey, assignment: '' }],
        role: 'specialist',
        manager: next.projects.find((p) => p.id === change.projectId)?.coordinator ?? null,
        department: null,
        inventory: null,
        status: 'new',
        drift: [],
        learnedSkills: 0,
        pendingMemoryProposals: 0,
        reflections: { total: 0, saved: 0, failed: 0 },
      });
      continue;
    }
    const agent = find(change.agentId);
    if (!agent) continue;
    switch (change.kind) {
      case 'skills': {
        const removed = new Set(change.remove.map((r) => r.name));
        agent.skills = [...agent.skills.filter((name) => !removed.has(name)), ...change.add];
        break;
      }
      case 'toolDeny':
      case 'templateToolDeny':
        agent.toolDeny = unique([...agent.toolDeny, ...change.add]);
        break;
      case 'skillsDisabled':
        agent.skillsDisabled = unique([...agent.skillsDisabled, ...change.add]);
        break;
      case 'instructions':
        agent.instructions = change.to;
        break;
      case 'soul':
        agent.soul = change.to;
        break;
      case 'reasoning':
        agent.reasoningEffort = change.to;
        break;
      case 'model':
        agent.model = change.to;
        break;
      case 'browser':
        agent.browser = 'gateway';
        break;
      case 'triggers':
        agent.triggerOnMention = change.mention;
        agent.triggerOnAssign = change.assign;
        break;
      case 'name':
        agent.name = change.to;
        break;
      case 'org':
        if (change.department) agent.department = change.department.to;
        if (change.role) agent.role = change.role.to;
        if (change.reportsTo) agent.manager = change.reportsTo.to;
        break;
      case 'assignment': {
        const membership = agent.projects.find((p) => p.id === change.projectId);
        if (membership) membership.assignment = change.to;
        break;
      }
    }
  }
  return next;
}

function planAgent(
  agent: CurrentAgent,
  target: AgentTarget,
  state: CurrentState,
  sections: Set<Section>,
  plan: Plan,
): void {
  const who = `@${agent.username}`;
  const ref = { agentId: agent.id, username: agent.username };
  const library = new Set(state.library);
  const bundled = new Set(
    (agent.inventory?.skills ?? []).filter((s) => s.origin === 'bundled').map((s) => s.name),
  );

  if (sections.has('skills')) {
    const linked = new Set(agent.skills);
    const add: string[] = [];
    const remove: { name: string; why: 'target' | 'bundled-duplicate' }[] = [];
    for (const name of unique(target.addSkills)) {
      if (!library.has(name)) plan.skipped.push(`${who}: skill ${name} is not in the library`);
      else if (bundled.has(name))
        plan.skipped.push(
          `${who}: skill ${name} ships with Hermes in this profile; that one serves`,
        );
      else if (!linked.has(name)) add.push(name);
    }
    for (const name of agent.skills) {
      if (bundled.has(name)) remove.push({ name, why: 'bundled-duplicate' });
      else if (target.removeSkills?.includes(name)) remove.push({ name, why: 'target' });
    }
    if (add.length || remove.length) plan.changes.push({ kind: 'skills', ...ref, add, remove });
  }

  if (sections.has('tools')) {
    const deny = unique(target.denyToolsets).filter((name) => !agent.toolDeny.includes(name));
    if (deny.length) plan.changes.push({ kind: 'toolDeny', ...ref, add: deny });
    // A skill of the library the agent has keeps working: never turn its name off.
    const wanted = new Set([...agent.skills, ...target.addSkills]);
    const disable: string[] = [];
    for (const name of unique(target.disableSkills)) {
      if (agent.skillsDisabled.includes(name)) continue;
      if (wanted.has(name))
        plan.skipped.push(`${who}: ${name} stays on, it is one of the agent's own skills`);
      else disable.push(name);
    }
    if (disable.length) plan.changes.push({ kind: 'skillsDisabled', ...ref, add: disable });
  }

  if (sections.has('instructions')) {
    for (const kind of ['instructions', 'soul'] as const) {
      const wanted = target[kind];
      if (!wanted) continue;
      const text = resolveText(wanted, state);
      const current = kind === 'soul' ? agent.soul : agent.instructions;
      let decision = textDecision(current, text);
      const template = state.agents.find((a) => a.template && a.username === agent.copyOf);
      if (
        decision === 'owned' &&
        kind === 'instructions' &&
        'overTemplate' in wanted &&
        wanted.overTemplate &&
        template &&
        (current ?? '').trim() === (template.instructions ?? '').trim()
      ) {
        decision = 'replace';
      }
      if (decision === 'replace') {
        plan.changes.push({ kind, ...ref, from: current ?? '', to: text.text.trim() });
      } else if (decision === 'owned') {
        plan.skipped.push(`${who}: ${kind} changed since the audit; left as it is`);
      }
    }
  }

  if (sections.has('projects')) {
    for (const [key, text] of Object.entries(target.assignments ?? {})) {
      const membership = agent.projects.find((p) => p.key === key);
      if (!membership) {
        plan.skipped.push(`${who}: not in project ${key}, no assignment`);
        continue;
      }
      const decision = textDecision(membership.assignment, text);
      if (decision === 'replace') {
        plan.changes.push({
          kind: 'assignment',
          ...ref,
          projectId: membership.id,
          projectKey: key,
          from: membership.assignment,
          to: text.text.trim(),
        });
      } else if (decision === 'owned') {
        plan.skipped.push(`${who}: assignment in ${key} changed since the audit; left as it is`);
      }
    }
  }

  if (sections.has('copies') && target.triggers) {
    const { mention, assign } = target.triggers;
    if (agent.triggerOnMention !== mention || agent.triggerOnAssign !== assign) {
      plan.changes.push({ kind: 'triggers', ...ref, mention, assign });
    }
  }

  if (sections.has('copies') && target.name && agent.name !== target.name) {
    const template = state.agents.find((a) => a.template && a.username === agent.copyOf);
    const key = agent.projects[0]?.key;
    // A copy's name is its template's with the project key until someone renames it.
    if (template && key && agent.name === `${template.name} ${key}`)
      plan.changes.push({ kind: 'name', ...ref, from: agent.name, to: target.name });
    else plan.skipped.push(`${who}: named "${agent.name}" by hand; left as it is`);
  }

  if (sections.has('copies') && target.org) {
    const change: Extract<Change, { kind: 'org' }> = { kind: 'org', ...ref };
    const { department, role, reportsTo } = target.org;
    if (department && agent.department !== department) {
      if (!state.departments.some((d) => d.name === department))
        plan.skipped.push(`${who}: no department "${department}"`);
      else if (agent.department !== null)
        plan.skipped.push(`${who}: in department "${agent.department}" by hand; left as it is`);
      else change.department = { from: null, to: department };
    }
    if (role && agent.role !== role) {
      // createAgent makes every project agent a specialist; any other role was chosen.
      if (agent.role === null || agent.role === 'specialist')
        change.role = { from: agent.role, to: role };
      else plan.skipped.push(`${who}: agent-team role ${agent.role} by hand; left as it is`);
    }
    if (reportsTo && agent.manager !== reportsTo) {
      if (!state.agents.some((a) => a.username === reportsTo && !a.template))
        plan.skipped.push(`${who}: @${reportsTo} does not exist`);
      else if (agent.manager !== null)
        plan.skipped.push(`${who}: reports to @${agent.manager} by hand; left as it is`);
      else change.reportsTo = { from: null, to: reportsTo };
    }
    if (change.department || change.role || change.reportsTo) plan.changes.push(change);
  }

  if (sections.has('browser') && target.projectBrowser) {
    if (agent.browser === 'none') plan.changes.push({ kind: 'browser', ...ref });
    else if (agent.browser === 'legacy')
      plan.skipped.push(`${who}: uses the old Hermes browser someone chose; left as it is`);
  }

  if (sections.has('reasoning')) {
    if (target.model && agent.model !== target.model) {
      if (agent.model !== null)
        plan.skipped.push(`${who}: model ${agent.model} was set by hand; left as it is`);
      else if (state.unavailableModels.includes(target.model))
        plan.skipped.push(`${who}: the provider refused ${target.model}; left on the default`);
      else plan.changes.push({ kind: 'model', ...ref, from: null, to: target.model });
    }
    if (target.reasoning && agent.reasoningEffort !== target.reasoning) {
      if (agent.reasoningEffort === null)
        plan.changes.push({ kind: 'reasoning', ...ref, from: null, to: target.reasoning });
      else
        plan.skipped.push(
          `${who}: reasoning ${agent.reasoningEffort} was set by hand; left as it is`,
        );
    }
  }
}

function planTemplates(state: CurrentState, target: TuningTarget, plan: Plan): void {
  for (const entry of target.templates ?? []) {
    const template = state.agents.find((a) => a.username === entry.username && a.template);
    if (!template) {
      plan.skipped.push(`template @${entry.username}: not in this team`);
      continue;
    }
    const add = unique(entry.denyToolsets).filter((name) => !template.toolDeny.includes(name));
    if (add.length) {
      plan.changes.push({
        kind: 'templateToolDeny',
        agentId: template.id,
        username: template.username,
        add,
      });
    }
  }
}

function planDepartments(state: CurrentState, target: TuningTarget, plan: Plan): void {
  const known = new Set(state.departments.map((d) => d.name));
  for (const entry of target.departments ?? []) {
    if (known.has(entry.name)) {
      const current = state.departments.find((d) => d.name === entry.name)!;
      if (current.parent !== entry.parent)
        plan.skipped.push(
          `department "${entry.name}": below "${current.parent ?? 'nothing'}"; left as it is`,
        );
      continue;
    }
    if (entry.parent !== null && !known.has(entry.parent)) {
      plan.skipped.push(`department "${entry.name}": no parent department "${entry.parent}"`);
      continue;
    }
    plan.changes.push({ kind: 'department', ...entry });
    known.add(entry.name);
  }
}

function planCopies(state: CurrentState, target: TuningTarget, plan: Plan): void {
  for (const entry of target.agents) {
    if (!entry.copyOf) continue;
    const { template: name, projectKey } = entry.copyOf;
    const existing = state.agents.find((a) => a.username === entry.username);
    if (existing) {
      if (existing.copyOf !== name || !existing.projects.some((p) => p.key === projectKey)) {
        plan.skipped.push(
          `@${entry.username}: exists, but not as the copy of @${name} in ${projectKey}; left as it is`,
        );
      }
      continue;
    }
    const template = state.agents.find((a) => a.username === name && a.template);
    const project = state.projects.find((p) => p.key === projectKey);
    if (!template || !project) {
      plan.skipped.push(
        `@${entry.username}: ${template ? `no project ${projectKey}` : `no template @${name}`}`,
      );
      continue;
    }
    const modelRefused = !!template.model && state.unavailableModels.includes(template.model);
    plan.changes.push({
      kind: 'copy',
      templateId: template.id,
      template: template.username,
      projectId: project.id,
      projectKey: project.key,
      username: entry.username,
      model: modelRefused ? null : template.model,
      modelRefused,
    });
  }
}

export function planTuning(
  state: CurrentState,
  target: TuningTarget,
  sections: Section[] = DEFAULT_SECTIONS,
): Plan {
  const problems = validateTarget(target);
  if (problems.length) throw new Error(`Invalid target:\n- ${problems.join('\n- ')}`);
  const wanted = new Set(sections);
  const plan: Plan = { changes: [], skipped: [] };
  // What every copy should have goes onto its template first, so a copy made in the same
  // run starts with it and keeps following its template.
  if (wanted.has('tools')) planTemplates(state, target, plan);
  if (wanted.has('copies')) {
    planDepartments(state, target, plan);
    planCopies(projectState(state, plan.changes), target, plan);
  }
  const projected = projectState(state, plan.changes);
  for (const entry of target.agents) {
    const agent = projected.agents.find((a) => a.username === entry.username);
    if (!agent) {
      plan.skipped.push(
        entry.copyOf && !wanted.has('copies')
          ? `@${entry.username}: not created yet (section copies)`
          : `@${entry.username}: no such agent in this team`,
      );
      continue;
    }
    if (agent.template) {
      plan.skipped.push(`@${entry.username}: a template, not a running agent`);
      continue;
    }
    if (agent.runtime !== 'hermes') {
      plan.skipped.push(`@${entry.username}: runs on ${agent.runtime}, not Hermes`);
      continue;
    }
    planAgent(agent, entry, projected, wanted, plan);
  }
  if (wanted.has('projects')) {
    for (const entry of target.projects) {
      const project = projected.projects.find((p) => p.key === entry.key);
      if (!project) {
        plan.skipped.push(`${entry.key}: no such project in this team`);
        continue;
      }
      const decision = textDecision(project.instructions, entry.instructions);
      if (decision === 'replace') {
        plan.changes.push({
          kind: 'projectInstructions',
          projectId: project.id,
          projectKey: project.key,
          from: project.instructions,
          to: entry.instructions.text.trim(),
        });
      } else if (decision === 'owned') {
        plan.skipped.push(
          `${entry.key}: project instructions changed since the audit; left as they are`,
        );
      }
    }
  }
  return plan;
}

// The changes that have to exist before the rest can be applied: templates and new copies.
// After them the state is loaded again and planned anew, with real ids for the copies.
export function isFirstPhase(change: Change): boolean {
  return (
    change.kind === 'copy' || change.kind === 'templateToolDeny' || change.kind === 'department'
  );
}

// ── The policy an agent ends up with ───────────────────────────────────────────────────

// The fields of a runtime policy (agents/core/service.ts AgentRuntimePolicy) the plan changes.
export interface PolicyLike {
  toolDeny: string[];
  skillsDisabled?: string[];
  reasoningEffort: string | null;
  files: { kind: 'instructions'; path: string; content: string }[];
}

// The agent's runtime policy with the plan's changes for it applied; every other field is
// kept as it is. Null when the plan changes nothing in it.
export function nextPolicy<P extends PolicyLike>(policy: P, changes: Change[]): P | null {
  let next: P = { ...policy };
  let changed = false;
  for (const change of changes) {
    if (change.kind === 'toolDeny' || change.kind === 'templateToolDeny') {
      next = { ...next, toolDeny: unique([...next.toolDeny, ...change.add]) };
      changed = true;
    } else if (change.kind === 'skillsDisabled') {
      next = { ...next, skillsDisabled: unique([...(next.skillsDisabled ?? []), ...change.add]) };
      changed = true;
    } else if (change.kind === 'reasoning') {
      next = { ...next, reasoningEffort: change.to };
      changed = true;
    } else if (change.kind === 'soul') {
      const others = next.files.filter((file) => file.path !== 'SOUL.md');
      next = {
        ...next,
        files: [{ kind: 'instructions', path: 'SOUL.md', content: change.to }, ...others],
      };
      changed = true;
    }
  }
  return changed ? next : null;
}

// ── Report ─────────────────────────────────────────────────────────────────────────────

// Hermes' own limits of the two memory files (hermes_cli/config_defaults.py memory_char_limit
// and user_char_limit); Helena leaves them at the defaults.
export const MEMORY_LIMITS: Record<InventoryMemory['file'], number> = {
  'MEMORY.md': 2200,
  'USER.md': 1375,
};

// What the runtime state says about each agent: whether its runner reports, drift, the
// skills it links against the skills Hermes really loads, memory against its limits, and
// whether it learns. Read-only; one line per agent.
export function auditState(state: CurrentState): string[] {
  const lines: string[] = [];
  for (const agent of [...state.agents].sort((a, b) => a.id - b.id)) {
    if (agent.template) continue;
    const who = `@${agent.username} (#${agent.id}, ${agent.runtime})`;
    const findings: string[] = [];
    if (agent.status !== 'online') findings.push(`runner ${agent.status}`);
    for (const drift of agent.drift) findings.push(`drift ${drift.key}: ${drift.code}`);
    if (agent.role === 'specialist' && agent.projects.length === 1) {
      const coordinator = state.projects.find((p) => p.key === agent.projects[0]!.key)?.coordinator;
      if (coordinator && agent.manager !== coordinator) {
        findings.push(
          `reports to ${agent.manager ? `@${agent.manager}` : 'nobody'}, not @${coordinator}`,
        );
      }
    }
    if (agent.runtime !== 'hermes') {
      if (!agent.triggerOnMention && !agent.triggerOnAssign && agent.projects.length) {
        findings.push(
          `starts on no mention or assignment, yet works in ${agent.projects.map((p) => p.key).join(', ')}: a task delegated to it never starts a run`,
        );
      }
      lines.push(`${who}: ${findings.length ? findings.join('; ') : 'ok'}`);
      continue;
    }
    findings.push(
      `model ${agent.model ?? 'default'} · ${agent.reasoningEffort ?? 'default'}` +
        (agent.browser === 'gateway' ? ' · project browser' : ''),
    );
    if (!agent.triggerOnAssign && agent.role === 'specialist') {
      findings.push('a task delegated to it never starts a run');
    }
    const inventory = agent.inventory;
    if (!inventory) findings.push('no inventory reported yet');
    else {
      const byOrigin = (origin: InventorySkill['origin']) =>
        inventory.skills.filter((s) => s.origin === origin).map((s) => s.name);
      const plan = new Set(byOrigin('plan'));
      const bundled = new Set(byOrigin('bundled'));
      const missing = agent.skills.filter((name) => !plan.has(name) && !bundled.has(name));
      if (missing.length) findings.push(`linked but not in the profile: ${missing.join(', ')}`);
      const clash = agent.skills.filter((name) => bundled.has(name));
      if (clash.length)
        findings.push(`same name as a Hermes skill (skill_view refuses both): ${clash.join(', ')}`);
      findings.push(
        `skills: ${plan.size} Helena, ${bundled.size} Hermes-bundled, ${byOrigin('hub').length} hub, ${byOrigin('agent').length} learned`,
      );
      if (bundled.size === 0) findings.push('no Hermes-bundled skills in this profile');
      for (const memory of inventory.memory) {
        const limit = MEMORY_LIMITS[memory.file];
        const share = Math.round((memory.chars / limit) * 100);
        findings.push(`${memory.file} ${memory.chars}/${limit} chars (${share} %)`);
        if (share >= 80) findings.push(`${memory.file} is nearly full`);
      }
      if (inventory.memory.length === 0) findings.push('no memory yet');
    }
    if (agent.pendingMemoryProposals) {
      findings.push(`${agent.pendingMemoryProposals} memory write(s) wait for the owner`);
    }
    findings.push(
      `reflections (30 days): ${agent.reflections.total}, ${agent.reflections.saved} saved something, ${agent.reflections.failed} failed; learned skills: ${agent.learnedSkills}`,
    );
    lines.push(`${who}: ${findings.join('; ')}`);
  }
  return lines;
}

// ── Output ─────────────────────────────────────────────────────────────────────────────

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

// The plan as readable lines: per change what it does, texts in full with what they replace.
export function formatPlan(plan: Plan): string[] {
  const lines: string[] = [];
  for (const change of plan.changes) {
    const who =
      'username' in change
        ? `@${change.username}`
        : 'projectKey' in change
          ? change.projectKey
          : '';
    switch (change.kind) {
      case 'copy':
        lines.push(
          `${who}: new copy of template @${change.template} in ${change.projectKey}, model ` +
            (change.modelRefused
              ? `default (the provider refused the template's model)`
              : (change.model ?? 'default')) +
            '; reports to the project coordinator',
        );
        break;
      case 'skills':
        lines.push(
          `${who}: skills` +
            (change.add.length ? ` + ${change.add.join(', ')}` : '') +
            (change.remove.length
              ? ` − ${change.remove.map((r) => (r.why === 'bundled-duplicate' ? `${r.name} (Hermes has it)` : r.name)).join(', ')}`
              : ''),
        );
        break;
      case 'toolDeny':
        lines.push(`${who}: toolsets off + ${change.add.join(', ')}`);
        break;
      case 'templateToolDeny':
        lines.push(`template ${who}: toolsets off + ${change.add.join(', ')} (its copies follow)`);
        break;
      case 'skillsDisabled':
        lines.push(`${who}: Hermes skills off + ${change.add.join(', ')}`);
        break;
      case 'reasoning':
      case 'model':
        lines.push(`${who}: ${change.kind} ${change.from ?? 'default'} → ${change.to}`);
        break;
      case 'browser':
        lines.push(`${who}: project browser on`);
        break;
      case 'department':
        lines.push(
          `new department "${change.name}"${change.parent ? ` below "${change.parent}"` : ''}: ${change.description}`,
        );
        break;
      case 'name':
        lines.push(`${who}: name "${change.from}" → "${change.to}"`);
        break;
      case 'org': {
        const parts = [
          change.department && `department → "${change.department.to}"`,
          change.role && `agent-team role ${change.role.from ?? 'none'} → ${change.role.to}`,
          change.reportsTo && `reports to → @${change.reportsTo.to}`,
        ].filter(Boolean);
        lines.push(`${who}: ${parts.join(', ')}`);
        break;
      }
      case 'triggers':
        lines.push(
          `${who}: runs when mentioned ${change.mention ? 'on' : 'off'}, when delegated to ${change.assign ? 'on' : 'off'}`,
        );
        break;
      case 'instructions':
      case 'soul':
      case 'assignment':
      case 'projectInstructions': {
        const what =
          change.kind === 'assignment'
            ? `assignment in ${change.projectKey}`
            : change.kind === 'projectInstructions'
              ? 'project instructions'
              : change.kind;
        lines.push(`${who}: ${what}`);
        lines.push(`    was (${change.from.trim().length} chars):`);
        lines.push(change.from.trim() ? indent(change.from.trim()) : '      (empty)');
        lines.push(`    becomes (${change.to.length} chars):`);
        lines.push(indent(change.to));
        break;
      }
    }
  }
  for (const line of plan.skipped) lines.push(`skip ${line}`);
  return lines;
}
