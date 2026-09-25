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
//   project) replaces only an empty field or the text the audit saw; one the owner wrote
//   since is left alone and reported.
// - Only running Hermes agents are touched: no template, no Claude Code or Codex agent.

import { createHash } from 'node:crypto';

export interface TextTarget {
  text: string;
  // SHA-256 of the texts this one may replace. An empty field is always replaced.
  replaces: string[];
}

export interface AgentTarget {
  username: string;
  // Skills of the team's library the agent should have, by name.
  addSkills: string[];
  // Skills to unlink, by name.
  removeSkills?: string[];
  // Hermes toolsets turned off for the agent (runtime policy toolDeny).
  denyToolsets: string[];
  // Skills of the runtime turned off by name (runtime policy skillsDisabled).
  disableSkills: string[];
  instructions?: TextTarget;
  // The agent's own SOUL.md (the first block of the SOUL.md Helena writes).
  soul?: TextTarget;
  // Reasoning effort, set only where the agent has none of its own (section `reasoning`).
  reasoning?: string;
  // The agent's assignment in a project (the project member description), by project key.
  assignments?: Record<string, TextTarget>;
}

export interface ProjectTarget {
  key: string;
  // The project-wide instructions every agent of the project reads.
  instructions: TextTarget;
}

export interface TuningTarget {
  projects: ProjectTarget[];
  agents: AgentTarget[];
}

export const SECTIONS = [
  'skills',
  'tools',
  'instructions',
  'projects',
  'reasoning',
  'report',
] as const;
export type Section = (typeof SECTIONS)[number];
// Reasoning costs subscription time and is the owner's call: only on request.
export const DEFAULT_SECTIONS: Section[] = ['skills', 'tools', 'instructions', 'projects', 'report'];

// The API's own bounds (organization/model.ts), which a text written here keeps as well, so
// the owner can still save it from Helena.
export const PROJECT_INSTRUCTIONS_MAX = 4000;
export const ASSIGNMENT_MAX = 500;
const NAME_MAX = 128;

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
  // 'hermes', 'claude' or 'codex'.
  runtime: string;
  instructions: string | null;
  soul: string | null;
  toolDeny: string[];
  skillsDisabled: string[];
  reasoningEffort: string | null;
  // Linked skills of the library, by name.
  skills: string[];
  projects: { id: number; key: string; assignment: string }[];
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
}

export interface CurrentState {
  agents: CurrentAgent[];
  projects: CurrentProject[];
  // The names of the team's skill library.
  library: string[];
}

// ── The plan ───────────────────────────────────────────────────────────────────────────

export type Change =
  | {
      kind: 'skills';
      agentId: number;
      username: string;
      add: string[];
      remove: { name: string; why: 'target' | 'bundled-duplicate' }[];
    }
  | { kind: 'toolDeny'; agentId: number; username: string; add: string[] }
  | { kind: 'skillsDisabled'; agentId: number; username: string; add: string[] }
  | {
      kind: 'instructions' | 'soul';
      agentId: number;
      username: string;
      from: string;
      to: string;
    }
  | {
      kind: 'reasoning';
      agentId: number;
      username: string;
      from: string | null;
      to: string;
    }
  | {
      kind: 'assignment';
      agentId: number;
      username: string;
      projectId: number;
      projectKey: string;
      from: string;
      to: string;
    }
  | { kind: 'projectInstructions'; projectId: number; projectKey: string; from: string; to: string };

export interface Plan {
  changes: Change[];
  // What the plan leaves alone and why.
  skipped: string[];
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Whether `target` may replace `current`: the same text needs nothing, an empty one or one
// the audit saw is replaced, anything else is the owner's.
export function textDecision(
  current: string | null | undefined,
  target: TextTarget,
): 'same' | 'replace' | 'owned' {
  const value = current?.trim() ?? '';
  if (value === target.text.trim()) return 'same';
  if (!value || target.replaces.includes(sha256(current ?? ''))) return 'replace';
  return 'owned';
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
      if (!name.trim() || name.length > NAME_MAX) problems.push(`@${agent.username}: name "${name}"`);
    }
    for (const name of agent.addSkills) {
      if (disabled.has(name)) problems.push(`@${agent.username}: ${name} is added and disabled`);
    }
    for (const [key, text] of Object.entries(agent.assignments ?? {})) {
      if (text.text.trim().length > ASSIGNMENT_MAX) {
        problems.push(`@${agent.username} in ${key}: assignment longer than ${ASSIGNMENT_MAX}`);
      }
    }
  }
  return problems;
}

const unique = (items: string[]) => [...new Set(items)];

function planAgent(
  agent: CurrentAgent,
  target: AgentTarget,
  library: Set<string>,
  sections: Set<Section>,
  plan: Plan,
): void {
  const who = `@${agent.username}`;
  const ref = { agentId: agent.id, username: agent.username };
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
        plan.skipped.push(`${who}: skill ${name} ships with Hermes in this profile; that one serves`);
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
      const text = target[kind];
      if (!text) continue;
      const current = kind === 'soul' ? agent.soul : agent.instructions;
      const decision = textDecision(current, text);
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

  if (sections.has('reasoning') && target.reasoning) {
    if (agent.reasoningEffort === null) {
      plan.changes.push({ kind: 'reasoning', ...ref, from: null, to: target.reasoning });
    } else if (agent.reasoningEffort !== target.reasoning) {
      plan.skipped.push(`${who}: reasoning ${agent.reasoningEffort} was set by hand; left as it is`);
    }
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
  const library = new Set(state.library);
  for (const entry of target.agents) {
    const agent = state.agents.find((a) => a.username === entry.username);
    if (!agent) {
      plan.skipped.push(`@${entry.username}: no such agent in this team`);
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
    planAgent(agent, entry, library, wanted, plan);
  }
  if (wanted.has('projects')) {
    for (const entry of target.projects) {
      const project = state.projects.find((p) => p.key === entry.key);
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
        plan.skipped.push(`${entry.key}: project instructions changed since the audit; left as they are`);
      }
    }
  }
  return plan;
}

// ── The policy an agent ends up with ───────────────────────────────────────────────────

export interface PolicyLike {
  toolDeny: string[];
  skillsDisabled?: string[];
  reasoningEffort: string | null;
  files: { kind: 'instructions'; path: string; content: string }[];
  [key: string]: unknown;
}

// The agent's runtime policy with the plan's changes for it applied; every other field is
// kept as it is. Null when the plan changes nothing in it.
export function nextPolicy<P extends PolicyLike>(policy: P, changes: Change[]): P | null {
  let next: P = { ...policy };
  let changed = false;
  for (const change of changes) {
    if (change.kind === 'toolDeny') {
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
// whether it learns. Read-only; one line per finding.
export function auditState(state: CurrentState): string[] {
  const lines: string[] = [];
  for (const agent of [...state.agents].sort((a, b) => a.id - b.id)) {
    if (agent.template) continue;
    const who = `@${agent.username} (#${agent.id}, ${agent.runtime})`;
    const findings: string[] = [];
    if (agent.status !== 'online') findings.push(`runner ${agent.status}`);
    for (const drift of agent.drift) findings.push(`drift ${drift.key}: ${drift.code}`);
    if (agent.runtime !== 'hermes') {
      if (!agent.triggerOnMention && !agent.triggerOnAssign && agent.projects.length) {
        findings.push(
          `starts on no mention or assignment, yet works in ${agent.projects.map((p) => p.key).join(', ')}: a coordinator that delegates to it waits for nothing`,
        );
      }
      lines.push(`${who}: ${findings.length ? findings.join('; ') : 'ok'}`);
      continue;
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
    const who = 'username' in change ? `@${change.username}` : change.projectKey;
    switch (change.kind) {
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
      case 'skillsDisabled':
        lines.push(`${who}: Hermes skills off + ${change.add.join(', ')}`);
        break;
      case 'reasoning':
        lines.push(`${who}: reasoning ${change.from ?? 'default'} → ${change.to}`);
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
