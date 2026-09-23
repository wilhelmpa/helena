import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

// What an agent can do in its Hermes profile, which Plan shows read-only. The toolsets and
// MCP servers are static configuration and come from the runner config; the skills and the
// memory change while the agent works and are read from the profile.

// The toolsets and MCP servers the profile's config.yaml enables for the cli platform.
export interface HermesProfile {
  toolsets: string[];
  mcpServers: string[];
}

// 'plan' is a skill the policy materializer wrote, 'hub' one installed from the Skills Hub,
// and 'agent' one that is neither bundled with Hermes nor installed, which Hermes counts as
// created by the agent.
export type SkillOrigin = 'bundled' | 'hub' | 'plan' | 'agent';

export interface InventorySkill {
  name: string;
  category: string | null;
  description: string;
  origin: SkillOrigin;
}

export interface InventoryMemory {
  file: 'MEMORY.md' | 'USER.md';
  content: string;
  truncated: boolean;
}

export interface HermesInventory extends HermesProfile {
  skills: InventorySkill[];
  memory: InventoryMemory[];
}

// The API refuses a report past these bounds, so the runner keeps within them.
const MAX_NAMES = 64;
const MAX_NAME = 128;
const MAX_SKILLS = 300;
const MAX_DESCRIPTION = 300;
const MAX_MEMORY = 16 * 1024;
const FRONTMATTER_BYTES = 8 * 1024;
const LIST_BYTES = 256 * 1024;
const MEMORY_FILES = ['MEMORY.md', 'USER.md'] as const;
const PLAN_CATEGORY = 'plan-managed';

// Up to `limit` bytes of a regular file, or null when there is none. A symlink is not
// followed, so a link placed in the profile cannot send another file's content to Plan.
async function readHead(
  path: string,
  limit: number,
): Promise<{ text: string; size: number } | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') return null;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(limit, info.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), size: info.size };
  } finally {
    await handle.close();
  }
}

async function directories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

// At most `max` UTF-16 units, without ending on half of a surrogate pair: Postgres refuses
// a lone surrogate in jsonb, and the API stores the inventory there.
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

// The `name` and `description` of a SKILL.md frontmatter. Both are plain or quoted
// scalars, now and then a block scalar, so the lines are read directly instead of through
// a YAML parser.
export function skillFrontmatter(text: string): { name?: string; description?: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const fields: { name?: string; description?: string } = {};
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === '---') break;
    const match = /^(name|description):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    let value = match[2].trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        block.push(lines[++index].trim());
      }
      value = block.join(' ');
    }
    fields[match[1] as 'name' | 'description'] = unquote(value);
  }
  return fields;
}

// `.bundled_manifest` holds one `name:hash` line per bundled skill.
async function bundledNames(skills: string): Promise<Set<string>> {
  const manifest = await readHead(join(skills, '.bundled_manifest'), LIST_BYTES);
  return new Set(
    (manifest?.text ?? '')
      .split('\n')
      .map((line) => line.split(':', 1)[0].trim())
      .filter(Boolean),
  );
}

async function hubNames(skills: string): Promise<Set<string>> {
  const lock = await readHead(join(skills, '.hub', 'lock.json'), LIST_BYTES);
  try {
    const installed = (JSON.parse(lock?.text ?? '{}') as { installed?: unknown }).installed;
    return new Set(installed && typeof installed === 'object' ? Object.keys(installed) : []);
  } catch {
    return new Set();
  }
}

async function skillAt(
  dir: string,
  category: string | null,
): Promise<Omit<InventorySkill, 'origin'> | null> {
  const file = await readHead(join(dir, 'SKILL.md'), FRONTMATTER_BYTES);
  if (!file) return null;
  const fields = skillFrontmatter(file.text);
  return {
    name: cut(fields.name?.trim() || basename(dir), MAX_NAME),
    description: cut((fields.description ?? '').trim(), MAX_DESCRIPTION),
    category: category === null ? null : cut(category, MAX_NAME),
  };
}

function originOf(
  skill: Omit<InventorySkill, 'origin'>,
  bundled: Set<string>,
  hub: Set<string>,
): SkillOrigin {
  if (skill.category === PLAN_CATEGORY) return 'plan';
  if (bundled.has(skill.name)) return 'bundled';
  if (hub.has(skill.name)) return 'hub';
  return 'agent';
}

// Hermes keeps a skill at skills/<name>/SKILL.md or skills/<category>/<name>/SKILL.md.
async function readSkills(hermesHome: string): Promise<InventorySkill[]> {
  const root = join(hermesHome, 'skills');
  const [bundled, hub] = await Promise.all([bundledNames(root), hubNames(root)]);
  const found: Omit<InventorySkill, 'origin'>[] = [];
  for (const top of await directories(root)) {
    const own = await skillAt(join(root, top), null);
    if (own) {
      found.push(own);
      continue;
    }
    for (const name of await directories(join(root, top))) {
      const skill = await skillAt(join(root, top, name), top);
      if (skill) found.push(skill);
    }
  }
  return found
    .map((skill) => ({ ...skill, origin: originOf(skill, bundled, hub) }))
    .sort(
      (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_SKILLS);
}

async function readMemory(hermesHome: string): Promise<InventoryMemory[]> {
  return Promise.all(
    MEMORY_FILES.map(async (file) => {
      // Four bytes per character at most, so the character limit is reached whatever the
      // file holds.
      const read = await readHead(join(hermesHome, 'memories', file), MAX_MEMORY * 4);
      const text = read?.text ?? '';
      return {
        file,
        content: cut(text, MAX_MEMORY),
        truncated: text.length > MAX_MEMORY || (read !== null && read.size > MAX_MEMORY * 4),
      };
    }),
  );
}

function names(values: string[] | undefined): string[] {
  return (values ?? [])
    .filter((value) => value.length > 0 && value.length <= MAX_NAME)
    .slice(0, MAX_NAMES);
}

export async function readHermesInventory(
  hermesHome: string,
  profile: HermesProfile | undefined,
): Promise<HermesInventory> {
  const [skills, memory] = await Promise.all([readSkills(hermesHome), readMemory(hermesHome)]);
  return {
    toolsets: names(profile?.toolsets),
    mcpServers: names(profile?.mcpServers),
    skills,
    memory,
  };
}
