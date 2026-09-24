import { Elysia, type Static } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, project } from '@repo/db';
import {
  dailyNotePath,
  ensureDailyNote,
  expandTemplate,
  inboxFolder,
  instanceHome,
  knowledgeRegistries,
  listTemplates,
  readTemplate,
  recordActorWrite,
  reindexVaultPaths,
  safeNoteName,
  templatesFolder,
  webNoteText,
  webPageToNote,
  writeUniqueNote,
} from '@helena/knowledge';
import { isNotePath, isWithin, normalizeVaultPath, VaultError } from '@repo/vault';
import { requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { pinnedFetch } from '#shared/net';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import {
  CaptureResponse,
  captureBody,
  captureWebBody,
  fromTemplateBody,
  JournalResponse,
  journalBody,
  NoteCreatedResponse,
  TemplatesResponse,
} from './everything-model';
import { canAccess, vaultScope, type VaultScope } from './scope';
import { vaultCall } from './service';

// "Save to knowledge" from every surface (chat, browser, mail, task, ⌘K), the daily note
// and notes from templates. Captures go through the registered capture targets
// (@helena/sdk CaptureTarget, the built-in `inbox` and `journal`); before a target runs,
// the caller must be able to write where it writes, by the vault's own rules (scope.ts).

async function scopeOf(user: unknown, request: Request): Promise<VaultScope> {
  return vaultScope(
    requireUser(user as Parameters<typeof requireUser>[0]),
    isMcpRequest(request.headers),
    request.headers,
  );
}

async function projectOf(key: string | undefined): Promise<{ id: number; teamId: number } | null> {
  if (!key) return null;
  const [row] = await db
    .select({ id: project.id, teamId: project.teamId })
    .from(project)
    .where(eq(project.key, key.trim().toUpperCase()));
  if (!row) throw new HttpError(404, `Project ${key} not found`);
  return row;
}

// The team a capture without a project belongs to: Home's.
async function homeTeamId(): Promise<number> {
  const home = await instanceHome();
  if (home.teamId === null) throw new HttpError(404, 'No team');
  return home.teamId;
}

// Where a target writes, for the access check before it runs.
async function destinationOf(targetId: string, projectId: number | null, scope: VaultScope) {
  if (targetId === 'journal') return dailyNotePath(new Date(), scope.actor.timeZone);
  return inboxFolder(projectId);
}

async function capture(
  scope: VaultScope,
  input: {
    target?: string;
    kind?: Static<typeof captureBody>['kind'];
    title: string;
    text: string;
    origin?: string;
    from?: string;
    projectKey?: string;
    tags?: string[];
  },
) {
  const targetId = input.target ?? 'inbox';
  const target = knowledgeRegistries().captureTargets.get(targetId);
  if (!target) throw new HttpError(404, `Capture target ${targetId} not found`);
  const kind = input.kind ?? 'text';
  if (!target.accepts.includes(kind)) throw new HttpError(400, `${targetId} does not take ${kind}`);
  const found = await projectOf(input.projectKey);
  if (targetId === 'journal' && found) {
    throw new HttpError(400, 'The daily note belongs to Home; leave the project out');
  }
  const teamId = found?.teamId ?? (await homeTeamId());
  const destination = await destinationOf(targetId, found?.id ?? null, scope);
  if (!canAccess(scope, destination, 'write')) {
    throw new HttpError(403, `You cannot write ${destination}`);
  }
  const result = await vaultCall(() =>
    target.capture(
      {
        kind,
        title: input.title.trim(),
        text: input.text,
        origin: input.origin ?? null,
        from: input.from ?? null,
        teamId,
        projectId: found?.id ?? null,
        tags: input.tags,
      },
      {
        actor: scope.actor.ref,
        runId: scope.actor.runId,
        timeZone: scope.actor.timeZone,
        locale: scope.actor.locale,
      },
    ),
  );
  const path = result.item.startsWith('vault:') ? result.item.slice('vault:'.length) : null;
  if (path) await reindexVaultPaths([path]).catch(() => undefined);
  return { item: result.item, href: result.href, path };
}

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

// Fetches a page for a capture from its URL: public addresses only, redirects followed
// three times at most (each checked again), HTML only.
async function fetchPage(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await pinnedFetch(current, {
      timeoutMs: 15_000,
      maxBytes: MAX_PAGE_BYTES,
      truncateBody: true,
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Helena/1 (+capture)' },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location')!, current).toString();
      continue;
    }
    if (!response.ok) throw new HttpError(400, `The page answered ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!/html|xml/i.test(type)) throw new HttpError(400, 'The address is not a web page');
    return response.text();
  }
  throw new HttpError(400, 'The page redirects too often');
}

function vaultPathOrThrow(value: string): string {
  try {
    return normalizeVaultPath(value);
  } catch (error) {
    if (error instanceof VaultError) throw new HttpError(400, error.message);
    throw error;
  }
}

export const captureRoutes = new Elysia({
  name: 'knowledge-capture',
  detail: { tags: ['Knowledge'] },
})
  .use(authContext)
  .post(
    '/knowledge/capture',
    async ({ user, request, body, set }) => {
      const scope = await scopeOf(user, request);
      const created = await capture(scope, body);
      set.status = 201;
      return created;
    },
    {
      body: captureBody,
      response: { 201: CaptureResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Save something into the knowledge',
        description:
          'Save text (a finding, a quote, a chat answer, a summary) as a new note in the Inbox of a project (`projectKey`) or of Home, with where it came from (`origin`, a URL or the Helena item `from`). With target "journal" it becomes a line in today\'s daily note instead. Returns the note\'s path; link the task in the text with [[KEY-n]].',
        ...mcpTool('capture_note', { idempotentHint: false, openWorldHint: false }),
      },
    },
  )
  .post(
    '/knowledge/capture/web',
    async ({ user, request, body, set }) => {
      const scope = await scopeOf(user, request);
      let url: URL;
      try {
        url = new URL(body.url);
      } catch {
        throw new HttpError(400, 'The address is not a URL');
      }
      if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Only http(s) pages');
      const html = body.html ?? (await fetchPage(url.toString()));
      const page = await webPageToNote(html, url.toString());
      const created = await capture(scope, {
        target: 'inbox',
        kind: 'web-page',
        title: page.title,
        text: webNoteText(page, url.toString()),
        origin: url.toString(),
        projectKey: body.projectKey,
        tags: ['web', ...(body.tags ?? [])],
      });
      set.status = 201;
      return created;
    },
    {
      body: captureWebBody,
      response: { 201: CaptureResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Save a web page into the knowledge',
        description:
          "Save the readable part of a web page as a Markdown note in the Inbox of a project (`projectKey`) or of Home, with its title, author and source URL. Pass the page's `html` when you have it (a page behind a login); without it the page is fetched from `url`.",
        ...mcpTool('capture_web_page', { idempotentHint: false, openWorldHint: true }),
      },
    },
  )
  .post(
    '/knowledge/journal',
    async ({ user, request, body }) => {
      const scope = await scopeOf(user, request);
      const date = body.date ? new Date(`${body.date}T12:00:00Z`) : new Date();
      const relative = await dailyNotePath(date, scope.actor.timeZone);
      if (!canAccess(scope, relative, 'write')) {
        throw new HttpError(403, "The journal is Home's; you cannot write there");
      }
      const note = await vaultCall(() =>
        ensureDailyNote(date, {
          ref: scope.actor.ref,
          runId: scope.actor.runId,
          timeZone: scope.actor.timeZone,
          locale: scope.actor.locale,
        }),
      );
      if (note.created) await reindexVaultPaths([note.path]).catch(() => undefined);
      return note;
    },
    {
      body: journalBody,
      response: { 200: JournalResponse, ...commonErrors },
      detail: {
        summary: 'Open the daily note',
        description:
          "The path of the day's note in the journal, made from the daily note template when the day has none yet (Obsidian's daily notes settings decide folder, name and template).",
      },
    },
  )
  .get(
    '/knowledge/templates',
    async ({ user, request }) => {
      const scope = await scopeOf(user, request);
      return (await listTemplates()).filter((template) => canAccess(scope, template.path, 'read'));
    },
    {
      response: { 200: TemplatesResponse, ...commonErrors },
      detail: {
        summary: 'List the note templates',
        description: 'The notes in the templates folder, which a new note can start from.',
      },
    },
  )
  .post(
    '/knowledge/notes/from-template',
    async ({ user, request, body, set }) => {
      const scope = await scopeOf(user, request);
      const template = vaultPathOrThrow(body.template);
      const folder = vaultPathOrThrow(body.folder);
      if (!isNotePath(template) || !isWithin(template, await templatesFolder())) {
        throw new HttpError(400, 'Name a note of the templates folder');
      }
      if (!canAccess(scope, template, 'read')) throw new HttpError(403, 'You cannot read it');
      if (!folder || !canAccess(scope, `${folder}/x.md`, 'write')) {
        throw new HttpError(403, `You cannot write in ${folder || 'the vault root'}`);
      }
      const source = await readTemplate(template);
      if (source === null) throw new HttpError(404, 'Template not found');
      const title = body.title.trim();
      const content = expandTemplate(source, {
        title,
        date: new Date(),
        locale: scope.actor.locale,
        timeZone: scope.actor.timeZone,
      });
      const path = await vaultCall(() => writeUniqueNote(folder, safeNoteName(title), content));
      await recordActorWrite([path], `Create ${path}`, {
        ref: scope.actor.ref,
        runId: scope.actor.runId,
      });
      await reindexVaultPaths([path]).catch(() => undefined);
      set.status = 201;
      return { path };
    },
    {
      body: fromTemplateBody,
      response: { 201: NoteCreatedResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Create a note from a template',
        description:
          'A new note named after the title in a folder, from a template with its {{title}}, {{date}} and {{time}} filled in.',
      },
    },
  );
