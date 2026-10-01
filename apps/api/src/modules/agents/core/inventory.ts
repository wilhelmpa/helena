import type { AgentRuntimeInventory } from './service';
import { truncateSkillDescription } from '@helena/sdk';

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const cut = (value: string, max: number) => {
  const end = Math.min(value.length, max);
  const code = value.charCodeAt(end - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
};
const name = (value: unknown) =>
  typeof value === 'string' && value.trim() ? cut(value.trim(), 128) : null;
const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const names = (value: unknown) =>
  items(value)
    .map(name)
    .filter((entry): entry is string => entry !== null)
    .slice(0, 64);

export function normalizeRuntimeInventory(value: unknown): AgentRuntimeInventory | null {
  const raw = record(value);
  if (!raw) return null;
  const skills: AgentRuntimeInventory['skills'] = [];
  for (const entry of items(raw.skills)) {
    const skill = record(entry);
    const skillName = name(skill?.name);
    if (!skill || !skillName || typeof skill.description !== 'string') continue;
    const origin = skill.origin;
    if (origin !== 'agent' && origin !== 'bundled' && origin !== 'hub' && origin !== 'plan')
      continue;
    skills.push({
      name: skillName,
      category: name(skill.category),
      description: truncateSkillDescription(skill.description),
      origin,
      ...(typeof skill.path === 'string' && skill.path.trim()
        ? { path: cut(skill.path, 260) }
        : {}),
      ...(typeof skill.pinned === 'boolean' ? { pinned: skill.pinned } : {}),
    });
    if (skills.length === 300) break;
  }
  const memory: AgentRuntimeInventory['memory'] = [];
  for (const entry of items(raw.memory)) {
    const file = record(entry);
    if (
      !file ||
      (file.file !== 'MEMORY.md' && file.file !== 'USER.md') ||
      typeof file.content !== 'string' ||
      typeof file.truncated !== 'boolean'
    )
      continue;
    memory.push({
      file: file.file,
      content: cut(file.content, 16384),
      truncated: file.truncated || file.content.length > 16384,
      ...(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)
        ? { sha256: file.sha256 }
        : {}),
      ...(typeof file.chars === 'number' && Number.isInteger(file.chars) && file.chars >= 0
        ? { chars: file.chars }
        : {}),
    });
    if (memory.length === 2) break;
  }
  return {
    toolsets: names(raw.toolsets),
    mcpServers: names(raw.mcpServers),
    skills,
    memory,
    ...(typeof raw.cronJobs === 'number' && Number.isInteger(raw.cronJobs) && raw.cronJobs >= 0
      ? { cronJobs: raw.cronJobs }
      : {}),
  };
}
