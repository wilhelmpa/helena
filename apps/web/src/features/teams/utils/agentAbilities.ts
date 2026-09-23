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
