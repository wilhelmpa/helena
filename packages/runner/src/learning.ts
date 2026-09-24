import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { atomicWrite, digest } from './files';
import {
  installedSkillNames,
  MAX_MEMORY_BYTES,
  MEMORY_FILES,
  PLAN_CATEGORY,
  skillFrontmatter,
  type InventorySkill,
  type MemoryFile,
} from './inventory';

// What the agent learns itself: the memory it writes and the skills it creates. Plan
// decides whether it may, and the owner reviews, takes over or discards what it learned.
// Hermes owns these files, so the runner changes them only when Plan asks for it.

export interface RuntimeLearning {
  // The agent keeps memory and creates skills.
  enabled: boolean;
  // Hermes' curator marks learned skills stale and archives them after a while unused.
  curator: boolean;
}

// An owner's decision Plan hands the runner with the policy. Each is carried out once,
// after the revision that carries it applied, and its result is reported back.
export type RuntimeAction =
  // Write the whole profile again and read it back ("Neu schreiben"); the synchronizer
  // carries it out with the apply of its revision.
  | { id: number; kind: 'rewrite-profile' }
  | { id: number; kind: 'discard-skill'; path: string }
  | { id: number; kind: 'pin-skill'; path: string; pinned: boolean }
  | {
      id: number;
      kind: 'write-memory';
      file: MemoryFile;
      content: string;
      // The digest of the content the owner edited; a file the agent changed since is
      // not overwritten.
      baseSha256: string;
    };

export interface RuntimeActionResult {
  id: number;
  error: string | null;
}

export interface LearnedSkillFile {
  path: string;
  content: string;
}

// A skill the agent created, with the content Plan shows and takes over into its library.
export interface LearnedSkill {
  path: string;
  name: string;
  markdown: string;
  files: LearnedSkillFile[];
  // Files Plan's library cannot hold, such as scripts, which a take-over leaves behind.
  otherFiles: number;
  // Past the size Plan accepts, so its content is left out.
  truncated: boolean;
}

// The Hermes configuration the runner layers over config.yaml for every run and chat
// answer. Hermes starts its post-turn review in a thread that a one-shot process ends
// before it finishes, and it pays for a session title Plan never shows; neither shows in
// the token counts Plan receives, so both are off. The agent learns in its own turn.
export function learningConfig(learning: RuntimeLearning | undefined): Record<string, unknown> {
  return {
    auxiliary: {
      background_review: { enabled: false },
      title_generation: { model_upgrade_enabled: false },
    },
    ...(learning && {
      memory: { memory_enabled: learning.enabled, user_profile_enabled: learning.enabled },
      // Hermes keeps a skill write it may not make as a pending proposal instead.
      skills: { write_approval: !learning.enabled },
    }),
  };
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_LEARNED = 50;
const MAX_LEARNED_FILES = 16;
const MAX_LEARNED_FILE_BYTES = 64 * 1024;
const MAX_LEARNED_BYTES = 1024 * 1024;
// The API refuses a longer path of a learned skill's file.
const MAX_FILE_PATH = 512;
const TEXT_FILE = /\.(?:md|markdown)$/i;

// The whole of a regular file, or null when there is none. A symlink is not followed.
async function readFileSafe(path: string, limit: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    if (code === 'ELOOP') throw new Error(`${basename(path)} is a symbolic link`);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${basename(path)} is not a file`);
    if (info.size > limit) throw new Error(`${basename(path)} is too large`);
    return (await handle.readFile()).toString('utf8');
  } finally {
    await handle.close();
  }
}

// A skill directory below skills/, one or two segments deep, that is neither a link nor
// one of Plan's skills, which `planSkills` names by their directory below plan-managed.
async function learnedSkillDir(
  hermesHome: string,
  path: string,
  planSkills: Set<string>,
): Promise<string> {
  const segments = path.split('/');
  if (segments.length > 2 || !segments.every((segment) => SEGMENT.test(segment))) {
    throw new Error('The skill path is invalid');
  }
  if (segments[0] === PLAN_CATEGORY && (segments.length === 1 || planSkills.has(segments[1]))) {
    throw new Error("Plan's own skills are changed in Plan");
  }
  let current = join(hermesHome, 'skills');
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The skill path is unsafe');
  }
  return current;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// The skill's name, refusing one that shipped with Hermes or came from the Skills Hub.
async function learnedSkillName(hermesHome: string, dir: string): Promise<string> {
  const markdown = await readFileSafe(join(dir, 'SKILL.md'), MAX_LEARNED_FILE_BYTES);
  if (markdown === null) throw new Error('The skill has no SKILL.md');
  const name = skillFrontmatter(markdown).name?.trim() || basename(dir);
  const installed = await installedSkillNames(join(hermesHome, 'skills'));
  if (installed.bundled.has(name) || installed.hub.has(name)) {
    throw new Error('Only a skill the agent created itself can be changed here');
  }
  return name;
}

// Moves the skill to skills/.archive, where Hermes keeps what it archives itself. Hermes
// no longer loads it from there, and `hermes curator restore` brings it back.
async function discardSkill(
  hermesHome: string,
  path: string,
  planSkills: Set<string>,
): Promise<void> {
  let dir: string;
  try {
    dir = await learnedSkillDir(hermesHome, path, planSkills);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  await learnedSkillName(hermesHome, dir);
  const archive = join(hermesHome, 'skills', '.archive');
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const name = basename(dir);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const taken = new Set(await readdir(archive));
  await rename(dir, join(archive, taken.has(name) ? `${name}-${stamp}` : name));
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const text = await readFileSafe(path, MAX_MEMORY_BYTES);
  if (text === null || !text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${basename(path)} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

// Hermes keeps a skill's pin in skills/.usage.json under the skill's name. A pinned skill
// is never changed by Hermes' review or archived by its curator.
async function pinSkill(
  hermesHome: string,
  path: string,
  pinned: boolean,
  planSkills: Set<string>,
): Promise<void> {
  const name = await learnedSkillName(
    hermesHome,
    await learnedSkillDir(hermesHome, path, planSkills),
  );
  const skills = join(hermesHome, 'skills');
  const usage = await readJsonObject(join(skills, '.usage.json'));
  const record = usage[name];
  usage[name] = {
    ...(record && typeof record === 'object' && !Array.isArray(record) ? record : {}),
    pinned,
  };
  await atomicWrite(skills, join(skills, '.usage.json'), `${JSON.stringify(usage, null, 2)}\n`);
}

async function writeMemory(
  hermesHome: string,
  file: MemoryFile,
  content: string,
  baseSha256: string,
): Promise<void> {
  if (!MEMORY_FILES.includes(file)) throw new Error('The memory file is invalid');
  const dir = join(hermesHome, 'memories');
  const current = (await readFileSafe(join(dir, file), MAX_MEMORY_BYTES)) ?? '';
  // Already written, by this action before the runner could report it.
  if (current === content) return;
  if (digest(current) !== baseSha256) {
    throw new Error('The memory changed since it was read; reload it and edit again');
  }
  await atomicWrite(dir, join(dir, file), content);
}

// Never throws: each action's failure is its result. An action is carried out again when
// the runner restarts before it reported the result, so each one holds when repeated.
export async function runActions(
  hermesHome: string,
  planSkills: Set<string>,
  actions: RuntimeAction[],
): Promise<RuntimeActionResult[]> {
  const results: RuntimeActionResult[] = [];
  for (const action of actions) {
    try {
      if (action.kind === 'discard-skill') {
        await discardSkill(hermesHome, action.path, planSkills);
      } else if (action.kind === 'pin-skill') {
        await pinSkill(hermesHome, action.path, action.pinned, planSkills);
      } else if (action.kind === 'write-memory') {
        await writeMemory(hermesHome, action.file, action.content, action.baseSha256);
      } else throw new Error('Unknown action');
      results.push({ id: action.id, error: null });
    } catch (error) {
      const message = isMissing(error)
        ? 'The skill no longer exists'
        : error instanceof Error
          ? error.message
          : 'Unknown error';
      results.push({ id: action.id, error: message.slice(0, 500) });
    }
  }
  return results;
}

// Hermes' curator pauses itself while skills/.curator_state says so, in every process
// that runs it. Returns true when the state had to be written.
export async function setCuratorPaused(hermesHome: string, paused: boolean): Promise<boolean> {
  const skills = join(hermesHome, 'skills');
  const path = join(skills, '.curator_state');
  let state: Record<string, unknown>;
  try {
    state = await readJsonObject(path);
  } catch {
    // Hermes reads an unreadable state as the defaults, which are not paused.
    state = {};
  }
  if (state.paused === paused) return false;
  await atomicWrite(
    skills,
    join(skills, '.curator_state'),
    `${JSON.stringify({ ...state, paused }, null, 2)}\n`,
  );
  return true;
}

async function markdownFiles(dir: string, prefix = ''): Promise<{ text: string[]; other: number }> {
  const found = { text: [] as string[], other: 0 };
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await markdownFiles(join(dir, entry.name), path);
      found.text.push(...nested.text);
      found.other += nested.other;
    } else if (entry.isFile() && path !== 'SKILL.md') {
      if (TEXT_FILE.test(entry.name) && SEGMENT.test(entry.name)) found.text.push(path);
      else found.other++;
    } else if (!entry.isFile()) found.other++;
  }
  return found;
}

// The content of the skills the agent created, as the inventory lists them.
export async function readLearnedSkills(
  hermesHome: string,
  skills: InventorySkill[],
): Promise<LearnedSkill[]> {
  const learned: LearnedSkill[] = [];
  let budget = MAX_LEARNED_BYTES;
  for (const skill of skills.filter((entry) => entry.origin === 'agent').slice(0, MAX_LEARNED)) {
    if (!skill.path) continue;
    const entry: LearnedSkill = {
      path: skill.path,
      name: skill.name,
      markdown: '',
      files: [],
      otherFiles: 0,
      truncated: false,
    };
    learned.push(entry);
    try {
      // The inventory already told the agent's skills from Plan's.
      const dir = await learnedSkillDir(hermesHome, skill.path, new Set());
      const markdown = (await readFileSafe(join(dir, 'SKILL.md'), MAX_LEARNED_FILE_BYTES)) ?? '';
      const found = await markdownFiles(dir);
      const files: LearnedSkillFile[] = [];
      for (const path of found.text.slice(0, MAX_LEARNED_FILES)) {
        files.push({
          path,
          content: (await readFileSafe(join(dir, path), MAX_LEARNED_FILE_BYTES)) ?? '',
        });
      }
      const size =
        Buffer.byteLength(markdown) +
        files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
      entry.otherFiles = found.other + Math.max(0, found.text.length - MAX_LEARNED_FILES);
      if (
        size > budget ||
        found.text.length > MAX_LEARNED_FILES ||
        found.text.some((path) => path.length > MAX_FILE_PATH)
      ) {
        entry.truncated = true;
        continue;
      }
      budget -= size;
      entry.markdown = markdown;
      entry.files = files;
    } catch {
      // A file past the size limit, or one that changed while it was read.
      entry.truncated = true;
    }
  }
  return learned;
}
