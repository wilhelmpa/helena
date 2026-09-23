import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { digest } from './files';

// What an agent can do in its Hermes profile, which Plan shows. The toolsets and MCP
// servers are static configuration and come from the runner config; the skills and the
// memory change while the agent works and are read from the profile.

// The toolsets and MCP servers the profile's config.yaml enables for the cli platform, and
// the plugins Plan requires in every home it serves, by name, each with the directory the
// home's plugins/ entry has to link to.
export interface HermesProfile {
  toolsets: string[];
  mcpServers: string[];
  plugins?: Record<string, string>;
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
  // The skill's directory below skills/, which an action of the owner names it by.
  path?: string;
  // Hermes' review never changes a pinned skill, and its curator never archives one.
  pinned: boolean;
}

export type MemoryFile = 'MEMORY.md' | 'USER.md';

export interface InventoryMemory {
  file: MemoryFile;
  content: string;
  truncated: boolean;
  // Of the whole file: an edit in Plan names the version it was made on.
  sha256: string;
  chars: number;
}

export interface HermesInventory {
  toolsets: string[];
  mcpServers: string[];
  skills: InventorySkill[];
  memory: InventoryMemory[];
  // Jobs in Hermes' own scheduler, which run outside Plan.
  cronJobs: number;
}

// The API refuses a report past these bounds, so the runner keeps within them.
const MAX_NAMES = 64;
const MAX_NAME = 128;
const MAX_SKILLS = 300;
const MAX_DESCRIPTION = 300;
const MAX_MEMORY = 16 * 1024;
export const MAX_MEMORY_BYTES = 1024 * 1024;
const FRONTMATTER_BYTES = 8 * 1024;
const LIST_BYTES = 256 * 1024;
export const MEMORY_FILES: MemoryFile[] = ['MEMORY.md', 'USER.md'];
export const PLAN_CATEGORY = 'plan-managed';
// The API refuses a longer skill path; a skill with one is listed without it, so no action
// can name it.
const MAX_PATH = 260;

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

// The names Hermes counts as shipped with it or installed from the Skills Hub.
export async function installedSkillNames(
  skills: string,
): Promise<{ bundled: Set<string>; hub: Set<string> }> {
  const [bundled, hub] = await Promise.all([bundledNames(skills), hubNames(skills)]);
  return { bundled, hub };
}

// Hermes keeps each skill's pin in skills/.usage.json under its name.
async function pinnedNames(skills: string): Promise<Set<string>> {
  const usage = await readHead(join(skills, '.usage.json'), LIST_BYTES);
  try {
    const records = JSON.parse(usage?.text ?? '{}') as Record<string, unknown>;
    return new Set(
      Object.entries(records)
        .filter(([, record]) => (record as { pinned?: unknown } | null)?.pinned === true)
        .map(([name]) => name),
    );
  } catch {
    return new Set();
  }
}

type FoundSkill = Omit<InventorySkill, 'origin' | 'pinned' | 'path'> & { path: string };

async function skillAt(
  dir: string,
  category: string | null,
  path: string,
): Promise<FoundSkill | null> {
  const file = await readHead(join(dir, 'SKILL.md'), FRONTMATTER_BYTES);
  if (!file) return null;
  const fields = skillFrontmatter(file.text);
  return {
    name: cut(fields.name?.trim() || basename(dir), MAX_NAME),
    description: cut((fields.description ?? '').trim(), MAX_DESCRIPTION),
    category: category === null ? null : cut(category, MAX_NAME),
    path,
  };
}

// A directory below plan-managed that the runner did not write is one the agent created
// there. Without the list of Plan's skills every one of them counts as Plan's.
function originOf(
  skill: FoundSkill,
  bundled: Set<string>,
  hub: Set<string>,
  planSkills: Set<string> | undefined,
): SkillOrigin {
  if (skill.category === PLAN_CATEGORY) {
    const slug = skill.path.slice(PLAN_CATEGORY.length + 1);
    if (!planSkills || planSkills.has(slug)) return 'plan';
    return 'agent';
  }
  if (bundled.has(skill.name)) return 'bundled';
  if (hub.has(skill.name)) return 'hub';
  return 'agent';
}

// Hermes keeps a skill at skills/<name>/SKILL.md or skills/<category>/<name>/SKILL.md.
async function readSkills(
  hermesHome: string,
  planSkills: Set<string> | undefined,
): Promise<InventorySkill[]> {
  const root = join(hermesHome, 'skills');
  const [{ bundled, hub }, pinned] = await Promise.all([
    installedSkillNames(root),
    pinnedNames(root),
  ]);
  const found: FoundSkill[] = [];
  for (const top of await directories(root)) {
    const own = await skillAt(join(root, top), null, top);
    if (own) {
      found.push(own);
      continue;
    }
    for (const name of await directories(join(root, top))) {
      const skill = await skillAt(join(root, top, name), top, `${top}/${name}`);
      if (skill) found.push(skill);
    }
  }
  return found
    .map(({ path, ...skill }) => ({
      ...skill,
      origin: originOf({ ...skill, path }, bundled, hub, planSkills),
      pinned: pinned.has(skill.name),
      ...(path.length <= MAX_PATH && { path }),
    }))
    .sort(
      (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_SKILLS);
}

async function readMemory(hermesHome: string): Promise<InventoryMemory[]> {
  return Promise.all(
    MEMORY_FILES.map(async (file) => {
      const read = await readHead(join(hermesHome, 'memories', file), MAX_MEMORY_BYTES);
      const text = read?.text ?? '';
      return {
        file,
        content: cut(text, MAX_MEMORY),
        truncated: text.length > MAX_MEMORY || (read !== null && read.size > MAX_MEMORY_BYTES),
        sha256: digest(text),
        chars: text.length,
      };
    }),
  );
}

// Hermes' scheduler runs the jobs in cron/jobs.json, `{ "jobs": [...] }`, on its own.
async function countCronJobs(hermesHome: string): Promise<number> {
  const file = await readHead(join(hermesHome, 'cron', 'jobs.json'), LIST_BYTES);
  try {
    const jobs = (JSON.parse(file?.text ?? '{}') as { jobs?: unknown }).jobs;
    return Array.isArray(jobs)
      ? jobs.filter((job) => (job as { enabled?: unknown } | null)?.enabled !== false).length
      : 0;
  } catch {
    return 0;
  }
}

function names(values: string[] | undefined): string[] {
  return (values ?? [])
    .filter((value) => value.length > 0 && value.length <= MAX_NAME)
    .slice(0, MAX_NAMES);
}

// `planSkills` names the directories below skills/plan-managed the runner wrote.
export async function readHermesInventory(
  hermesHome: string,
  profile: HermesProfile | undefined,
  planSkills?: Set<string>,
): Promise<HermesInventory> {
  const [skills, memory, cronJobs] = await Promise.all([
    readSkills(hermesHome, planSkills),
    readMemory(hermesHome),
    countCronJobs(hermesHome),
  ]);
  return {
    toolsets: names(profile?.toolsets),
    mcpServers: names(profile?.mcpServers),
    skills,
    memory,
    cronJobs,
  };
}
