import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { aiAgent, db, project, user } from '@repo/db';
import {
  absoluteVaultPath,
  commitVaultPaths,
  composeNote,
  HOME_DIR,
  indexVaultPaths,
  joinVaultPath,
  PLAN_AUTHOR,
  projectFolder,
  sha256Of,
  splitNote,
  VaultError,
  writeVaultFile,
  type GitAuthor,
} from '@repo/vault';
import type { CaptureInput, CaptureResult, CaptureTarget } from '@helena/sdk';
import {
  dailyNotesConfig,
  expandTemplate,
  formatDate,
  INBOX_HEADINGS,
  readTemplate,
} from './templates';
import { routes } from './sources/common';

// "Save to knowledge" targets. A capture is a Markdown note with the properties
// Obsidian's web clipper uses (`source`, `created`, `tags`), so a note clipped in the
// browser, in Obsidian or by an agent looks the same:
// - inbox: a new note in the project's Inbox/ (Home/Inbox without a project), to be
//   sorted later;
// - journal: a line under "Eingang" in today's daily note, made from the template when
//   the day has none yet.

export const INBOX_DIR = 'Inbox';
const MAX_NAME = 80;

export interface CaptureActor {
  // `user:<id>` or `agent:<id>`.
  ref: string;
  runId?: number | null;
  timeZone?: string;
  locale?: string;
}

// The git author for an actor ref: the person or the agent's bot user.
export async function gitAuthorFor(actor: string): Promise<GitAuthor> {
  const [kind, id] = [actor.slice(0, actor.indexOf(':')), actor.slice(actor.indexOf(':') + 1)];
  if (kind === 'agent') {
    const [row] = await db
      .select({ username: aiAgent.username, name: user.name })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(eq(aiAgent.id, Number(id) || 0));
    if (row)
      return { name: row.name || row.username, email: `${row.username}@agents.helena.local` };
  }
  if (kind === 'user') {
    const [row] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, id));
    if (row) return { name: row.name || 'Helena', email: row.email || 'helena@helena.local' };
  }
  return PLAN_AUTHOR;
}

// Records a write the actor made: the index with its author, and one commit carrying
// the actor and the run as trailers.
export async function recordActorWrite(
  paths: string[],
  message: string,
  actor: CaptureActor,
): Promise<void> {
  await indexVaultPaths(paths, { author: actor.ref, runId: actor.runId ?? null });
  await commitVaultPaths(paths, message, await gitAuthorFor(actor.ref), {
    trailers: {
      'Helena-Actor': actor.ref,
      ...(actor.runId ? { 'Helena-Run': String(actor.runId) } : {}),
    },
  });
}

// A file name from a title: no path separators or characters Obsidian, Windows or
// Syncthing refuse, no leading dot, at most 80 characters.
export function safeNoteName(title: string): string {
  const printable = [...title]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('');
  const cleaned = printable
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME)
    .trim();
  return cleaned || 'Notiz';
}

async function projectKeyOf(projectId: number | null): Promise<string | null> {
  if (projectId === null) return null;
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new VaultError(404, 'Project not found');
  return row.key;
}

export async function inboxFolder(projectId: number | null): Promise<string> {
  const key = await projectKeyOf(projectId);
  return key ? joinVaultPath(projectFolder(key), INBOX_DIR) : joinVaultPath(HOME_DIR, INBOX_DIR);
}

// Writes a new note under a name not taken yet ("Title", "Title 2", …).
export async function writeUniqueNote(
  folder: string,
  name: string,
  content: string,
): Promise<string> {
  const bytes = Buffer.from(content);
  for (let number = 1; number < 1000; number += 1) {
    const candidate = joinVaultPath(folder, `${number === 1 ? name : `${name} ${number}`}.md`);
    try {
      await writeVaultFile(candidate, bytes, null);
      return candidate;
    } catch (error) {
      if (error instanceof VaultError && error.code === 'exists') continue;
      throw error;
    }
  }
  throw new VaultError(409, 'Too many notes with this name');
}

export function captureNote(input: CaptureInput, now: Date, timeZone?: string): string {
  const frontmatter: Record<string, unknown> = {
    title: input.title,
    ...(input.origin ? { source: input.origin } : {}),
    created: formatDate(now, 'YYYY-MM-DD[T]HH:mm', 'en', timeZone),
    ...(input.from ? { helena: input.from } : {}),
    tags: [...new Set(['eingang', ...(input.tags ?? [])])],
  };
  return composeNote(frontmatter, `${input.text.trim()}\n`, null);
}

export async function captureToInbox(
  input: CaptureInput,
  actor: CaptureActor,
): Promise<CaptureResult> {
  const now = new Date();
  const folder = await inboxFolder(input.projectId);
  const name = safeNoteName(
    `${formatDate(now, 'YYYY-MM-DD', 'en', actor.timeZone)} ${input.title}`,
  );
  const relative = await writeUniqueNote(folder, name, captureNote(input, now, actor.timeZone));
  await recordActorWrite([relative], `Capture ${relative}`, actor);
  return { item: `vault:${relative}`, href: routes.note(relative) };
}

export async function dailyNotePath(date: Date, timeZone?: string): Promise<string> {
  const config = await dailyNotesConfig();
  return joinVaultPath(config.folder, `${formatDate(date, config.format, 'de', timeZone)}.md`);
}

async function readText(relative: string): Promise<string | null> {
  try {
    return await readFile(absoluteVaultPath(relative), 'utf8');
  } catch {
    return null;
  }
}

// Today's daily note, made from the daily note template when it does not exist yet.
export async function ensureDailyNote(
  date: Date,
  actor: CaptureActor,
): Promise<{ path: string; created: boolean }> {
  const relative = await dailyNotePath(date, actor.timeZone);
  if ((await readText(relative)) !== null) return { path: relative, created: false };
  const config = await dailyNotesConfig();
  const template = config.template ? await readTemplate(`${config.template}.md`) : null;
  const title = relative.slice(relative.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const content = expandTemplate(template ?? `# {{date:dddd, D. MMMM YYYY}}\n\n## Eingang\n`, {
    title,
    date,
    locale: actor.locale,
    timeZone: actor.timeZone,
  });
  try {
    await writeVaultFile(relative, Buffer.from(content), null);
  } catch (error) {
    if (error instanceof VaultError && error.code === 'exists')
      return { path: relative, created: false };
    throw error;
  }
  await recordActorWrite([relative], `Create ${relative}`, actor);
  return { path: relative, created: true };
}

// Adds a block under the daily note's inbox heading (the last line of that section), or
// at the end when the note has none. The write is checked against the version read, so
// an edit in between is never lost: the append is retried on the new version.
export function appendUnderInbox(content: string, block: string): string {
  const note = splitNote(content);
  const lines = note.body.split('\n');
  const heading = lines.findIndex((line) => INBOX_HEADINGS.includes(line.trim()));
  let insertAt = lines.length;
  if (heading !== -1) {
    insertAt = lines.findIndex((line, index) => index > heading && /^#{1,2}\s/.test(line));
    if (insertAt === -1) insertAt = lines.length;
    while (insertAt > heading + 1 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  } else {
    while (insertAt > 0 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
    lines.splice(insertAt, 0, '');
    insertAt += 1;
  }
  lines.splice(insertAt, 0, block);
  const body = lines.join('\n').replace(/\n*$/, '\n');
  return note.frontmatterRaw === null ? body : `---\n${note.frontmatterRaw}\n---\n${body}`;
}

export function journalBlock(input: CaptureInput, now: Date, timeZone?: string): string {
  const time = formatDate(now, 'HH:mm', 'en', timeZone);
  const text = input.text.trim();
  const head = input.origin ? `[${input.title}](${input.origin})` : input.title;
  const lines = text && text !== input.title ? text.split('\n').map((line) => `  ${line}`) : [];
  return [`- ${time} ${head}`.trimEnd(), ...lines].join('\n');
}

export async function captureToJournal(
  input: CaptureInput,
  actor: CaptureActor,
): Promise<CaptureResult> {
  const now = new Date();
  const { path: relative } = await ensureDailyNote(now, actor);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readText(relative);
    if (current === null) throw new VaultError(404, 'The daily note is gone');
    const next = appendUnderInbox(current, journalBlock(input, now, actor.timeZone));
    try {
      await writeVaultFile(relative, Buffer.from(next), sha256Of(Buffer.from(current)));
    } catch (error) {
      if (error instanceof VaultError && error.code === 'conflict') continue;
      throw error;
    }
    await recordActorWrite([relative], `Capture into ${relative}`, actor);
    return { item: `vault:${relative}`, href: routes.note(relative) };
  }
  throw new VaultError(409, 'The daily note kept changing');
}

// The targets as @helena/sdk capture targets. The API checks that the actor may write
// where a target writes before it calls one (see apps/api/src/modules/knowledge/capture).
function target(
  id: string,
  label: string,
  icon: string,
  run: (input: CaptureInput, actor: CaptureActor) => Promise<CaptureResult>,
): CaptureTarget {
  return {
    id,
    label: { i18n: label },
    icon,
    accepts: ['text', 'chat-message', 'web-page', 'mail-message', 'issue', 'file'],
    capture: (input, ctx) =>
      run(input, {
        ref: ctx.actor,
        runId: ctx.runId ?? null,
        timeZone: ctx.timeZone,
        locale: ctx.locale,
      }),
  };
}

export function builtinCaptureTargets(): CaptureTarget[] {
  return [
    target('inbox', 'knowledge.capture.inbox', 'inbox', captureToInbox),
    target('journal', 'knowledge.capture.journal', 'notebook-pen', captureToJournal),
  ];
}
