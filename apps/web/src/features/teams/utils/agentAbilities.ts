import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { groupInOrder } from './agentForm';

// The Hermes toolsets the Abilities section describes. Another toolset is shown by its
// name alone.
export const HERMES_TOOLSETS = [
  'browser',
  'clarify',
  'code_execution',
  'computer_use',
  'connections',
  'context_engine',
  'delegation',
  'file',
  'image_gen',
  'kanban',
  'memory',
  'session_search',
  'skills',
  'terminal',
  'todo',
  'tts',
  'video',
  'video_gen',
  'vision',
  'web',
  'x_search',
] as const;

export type HermesToolset = (typeof HERMES_TOOLSETS)[number];

export function isHermesToolset(name: string): name is HermesToolset {
  return (HERMES_TOOLSETS as readonly string[]).includes(name);
}

// The toolsets a template's copies will have. A template runs nowhere and has no runner
// of its own; its copies run on the team's runners, so it offers what they report. The
// toolsets it already denies stay listed, to be switched back on. Before any runner has
// reported, the toolsets Hermes is known to have.
export function templateToolsets(
  agents: { template: boolean; runtimeState: { inventory: { toolsets: string[] } | null } }[],
  denied: string[],
): string[] {
  const reported = agents.flatMap((agent) =>
    agent.template ? [] : (agent.runtimeState.inventory?.toolsets ?? []),
  );
  const known = reported.length > 0 ? reported : [...HERMES_TOOLSETS];
  return [...new Set([...known, ...denied.filter(isHermesToolset)])].sort();
}

// The runtime policy's toolDeny after a toolset is switched on or off. An entry that names
// no reported toolset is kept: the runner ignores it, and this screen does not show it.
export function toggleToolset(denied: string[], name: string, on: boolean): string[] {
  return on ? denied.filter((entry) => entry !== name) : [...new Set([...denied, name])];
}

// The skills that match the filter, grouped by category in the order the runner sent them.
// '' is the group of skills without a category.
export function skillGroups(
  skills: AgentInventorySkill[],
  query: string,
): [string, AgentInventorySkill[]][] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? skills.filter((skill) =>
        `${skill.name} ${skill.description} ${skill.category ?? ''}`.toLowerCase().includes(q),
      )
    : skills;
  return groupInOrder(matches, (skill) => skill.category ?? '');
}

// Skills of the agent's profile that share a name (docs/helena-decisions/agent-context.md §3):
// Hermes' skill_view refuses every one of them ("Ambiguous skill name"), so none of them
// loads. Typically a Helena skill named like one that ships with Hermes. Each clash lists
// where the skills of that name come from.
export interface SkillClash {
  name: string;
  origins: AgentInventorySkill['origin'][];
  paths: string[];
}

export function skillNameClashes(skills: AgentInventorySkill[]): SkillClash[] {
  const byName = new Map<string, AgentInventorySkill[]>();
  for (const skill of skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  return [...byName]
    .filter(([, found]) => found.length > 1 && new Set(found.map((skill) => skill.path)).size > 1)
    .map(([name, found]) => ({
      name,
      origins: found.map((skill) => skill.origin),
      paths: found.flatMap((skill) => (skill.path ? [skill.path] : [])),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
