import { Elysia } from 'elysia';
import { TASK_IDENTIFIER } from '@repo/vault';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { mcpTool } from '#mcp/generate';
import { commonErrors, errors } from '#shared/responses';
import { captureRoutes } from './capture-routes';
import { everythingRoutes } from './everything';
import { vaultGuard } from './guard';
import {
  backlinksQuery,
  ConflictListResponse,
  documentQuery,
  DocumentResponse,
  folderQuery,
  FolderResponse,
  HistoryResponse,
  LinkedNoteListResponse,
  moveBody,
  pathBody,
  pathQuery,
  PathResponse,
  rawQuery,
  resolveQuery,
  ResolveResponse,
  searchQuery,
  SearchResponse,
  TrashListResponse,
  treeQuery,
  recentQuery,
  RecentResponse,
  TreeResponse,
  uploadAssetBody,
  uploadAssetQuery,
  versionQuery,
  VersionResponse,
  wikilinkQuery,
  writeNoteBody,
  WriteNoteResponse,
} from './model';
import {
  backlinksToPath,
  backlinksToTask,
  createFolder,
  listConflicts,
  listFolder,
  listTrashed,
  listRecent,
  listTree,
  movePath,
  noteHistory,
  noteVersion,
  rawFile,
  readDocument,
  resolvePath,
  resolveWikilink,
  restorePath,
  searchKnowledge,
  trashPath,
  uploadAsset,
  vaultCall,
  writeNote,
} from './service';

// The knowledge vault: Docs on Markdown files, the other files beside them, and the
// index over both. Every route names the vault paths it acts on; the vault guard
// checks them against the caller's reach (scope.ts).
export const knowledgeRoutes = new Elysia({
  name: 'knowledge',
  detail: { tags: ['Knowledge'] },
})
  .use(authContext)
  .use(vaultGuard)
  .use(everythingRoutes)
  .use(captureRoutes)
  .get(
    '/knowledge/search',
    ({ scope, paths, query }) =>
      searchKnowledge(scope, { q: query.q, folder: paths.folder, limit: query.limit ?? 20 }),
    {
      vault: { action: 'read', fields: ['folder'] },
      query: searchQuery,
      response: { 200: SearchResponse, ...commonErrors },
      // Agents search through /knowledge/find (everything.ts), which covers the vault and
      // every other source under the same tool name; this one serves the Docs search.
      detail: {
        summary: 'Search the knowledge vault',
        description:
          'Ranked full-text search over the notes of the knowledge vault and the text extracted from its PDFs, scans, images and office files. Returns vault paths with a short excerpt (matches in **bold**). `folder` limits the search, e.g. "Projects/VOL" for one project or "Templates".',
      },
    },
  )
  .get(
    '/knowledge/documents',
    ({ paths, query }) => vaultCall(() => readDocument(paths.path, query.maxChars)),
    {
      vault: { action: 'read', fields: ['path'] },
      query: documentQuery,
      response: { 200: DocumentResponse, ...commonErrors, ...errors(413) },
      detail: {
        summary: 'Read a note or file',
        description:
          'Read a note or file of the knowledge vault by its path. A note comes back as Markdown (`content`, and `body` + `frontmatter` split apart) with its `sha256`; pass that sha256 to write_note to change the note. A PDF, scan, image or office file comes back as the text extracted from it (see `extractionStatus`). `absolutePath` is where the file is on the server: look at an image or a scan with your vision tool there.',
        ...mcpTool('read_document'),
      },
    },
  )
  .put(
    '/knowledge/notes',
    ({ scope, paths, body }) => vaultCall(() => writeNote(scope, { ...body, path: paths.path })),
    {
      vault: { action: 'write', fields: ['path'] },
      body: writeNoteBody,
      response: { 200: WriteNoteResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Create or update a note',
        description:
          'Write a Markdown note of the knowledge vault. Without `expectedSha` it creates a new note and fails with 409 if the path exists. With the `sha256` read_document returned it replaces the note, and fails with 409 if the note changed since: read it again and merge. Put findings, decisions and handovers into the project knowledge (Projects/<KEY>/Docs/...) and link the task with [[KEY-n]]; link other notes with [[Note name]].',
        ...mcpTool('write_note', { idempotentHint: false }),
      },
    },
  )
  .get(
    '/knowledge/folders',
    ({ scope, paths }) => vaultCall(() => listFolder(scope, paths.path ?? '')),
    {
      vault: { action: 'read', fields: ['path'] },
      query: folderQuery,
      response: { 200: FolderResponse, ...commonErrors, ...errors(413) },
      detail: {
        summary: 'List a folder',
        description:
          'List one folder of the knowledge vault: its notes, files and subfolders with title, type, size and extraction status. The project knowledge is under "Projects/<KEY>" (Docs, Files, Inbox and the area folders), shared templates under "Templates".',
        ...mcpTool('list_folder'),
      },
    },
  )
  .get(
    '/knowledge/backlinks',
    ({ scope, paths, query }) => {
      if (paths.path !== undefined) return backlinksToPath(scope, paths.path);
      const task = query.task?.trim().toUpperCase();
      if (!task || !TASK_IDENTIFIER.test(task)) {
        throw new HttpError(400, 'Name a note or file (path) or a task (task, e.g. "VOL-12")');
      }
      return backlinksToTask(scope, task);
    },
    {
      vault: { action: 'read', fields: ['path'] },
      query: backlinksQuery,
      response: { 200: LinkedNoteListResponse, ...commonErrors },
      detail: {
        summary: 'List the notes that link here',
        description:
          'List the notes that link to a note or file of the knowledge vault (`path`), or to a task (`task`, e.g. "VOL-12" for notes containing [[VOL-12]]).',
        ...mcpTool('backlinks'),
      },
    },
  )
  .get(
    '/knowledge/recent',
    ({ scope, paths, query }) => vaultCall(() => listRecent(scope, paths.root, query.limit ?? 50)),
    {
      vault: { action: 'read', fields: ['root'] },
      query: recentQuery,
      response: { 200: RecentResponse, ...commonErrors },
      detail: {
        summary: 'List the latest files',
        description:
          'The files below a folder of the knowledge vault, newest first: notes and every other file across all subfolders.',
      },
    },
  )
  .get('/knowledge/tree', ({ scope, paths }) => vaultCall(() => listTree(scope, paths.root)), {
    vault: { action: 'read', fields: ['root'] },
    query: treeQuery,
    response: { 200: TreeResponse, ...commonErrors, ...errors(413) },
    detail: {
      summary: 'List the Docs tree',
      description: 'Every note and folder below a folder, sorted by path.',
    },
  })
  .post(
    '/knowledge/folders',
    ({ paths, set }) =>
      vaultCall(async () => {
        const folder = await createFolder(paths.path);
        set.status = 201;
        return folder;
      }),
    {
      vault: { action: 'write', fields: ['path'] },
      body: pathBody,
      response: { 201: PathResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Create a folder',
        description: 'Create an empty folder, e.g. below a Docs root. 409 if the path exists.',
      },
    },
  )
  .post(
    '/knowledge/move',
    ({ scope, paths }) => vaultCall(() => movePath(scope, paths.from, paths.to)),
    {
      vault: { action: 'write', fields: ['from', 'to'] },
      body: moveBody,
      response: { 200: PathResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Move or rename a note or folder',
        description: 'The index keeps the links to what moved, and records the move.',
      },
    },
  )
  .post('/knowledge/trash', ({ scope, paths }) => vaultCall(() => trashPath(scope, paths.path)), {
    vault: { action: 'write', fields: ['path'] },
    body: pathBody,
    response: { 200: PathResponse, ...commonErrors, ...errors(409) },
    detail: {
      summary: 'Move a note or folder to the trash',
      description: 'Moves it to the vault trash (.trash) at the same relative path.',
    },
  })
  .get('/knowledge/trash', ({ paths }) => vaultCall(() => listTrashed(paths.path)), {
    vault: { action: 'read', fields: ['path'] },
    query: pathQuery,
    response: { 200: TrashListResponse, ...commonErrors },
    detail: {
      summary: 'List what was trashed below a folder',
      description:
        'The trashed files that came from below the folder, newest first, by their original path.',
    },
  })
  .post(
    '/knowledge/restore',
    ({ scope, paths }) => vaultCall(() => restorePath(scope, paths.path)),
    {
      vault: { action: 'write', fields: ['path'] },
      body: pathBody,
      response: { 200: PathResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Restore a trashed file to its path',
        description:
          'Move a file back from the trash to its original path. 409 if that path is taken.',
      },
    },
  )
  .get(
    '/knowledge/conflicts',
    ({ scope, paths }) => vaultCall(() => listConflicts(scope, paths.root)),
    {
      vault: { action: 'read', fields: ['root'] },
      query: treeQuery,
      response: { 200: ConflictListResponse, ...commonErrors },
      detail: {
        summary: 'List sync conflicts',
        description:
          'The copies Syncthing kept below a folder where two devices changed a file at the same time, each with the file it belongs to.',
      },
    },
  )
  .get('/knowledge/history', ({ paths }) => noteHistory(paths.path), {
    vault: { action: 'read', fields: ['path'] },
    query: pathQuery,
    response: { 200: HistoryResponse, ...commonErrors },
    detail: {
      summary: 'List the versions of a note',
      description: 'The commits of the vault history that changed the note, newest first.',
    },
  })
  .get('/knowledge/history/version', ({ paths, query }) => noteVersion(paths.path, query.commit), {
    vault: { action: 'read', fields: ['path'] },
    query: versionQuery,
    response: { 200: VersionResponse, ...commonErrors },
    detail: {
      summary: 'Read a note as it was at one commit',
      description: 'The whole file, frontmatter included, at one commit of its history.',
    },
  })
  .get(
    '/knowledge/raw',
    ({ paths, query, request }) =>
      vaultCall(() => rawFile(paths.path, request, query.download !== undefined)),
    {
      vault: { action: 'read', fields: ['path'] },
      query: rawQuery,
      response: { ...commonErrors },
      detail: {
        summary: 'Download a vault file',
        description: 'Images are shown inline; every other type is a download.',
      },
    },
  )
  .post(
    '/knowledge/assets',
    ({ scope, paths, body, set }) =>
      vaultCall(async () => {
        const asset = await uploadAsset(scope, paths.path, body.file);
        set.status = 201;
        return asset;
      }),
    {
      vault: { action: 'write', fields: ['path'] },
      query: uploadAssetQuery,
      body: uploadAssetBody,
      response: { 201: PathResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Add a file to a note',
        description: 'Stores the file beside the note.',
      },
    },
  )
  .get(
    '/knowledge/resolve',
    ({ scope, query }) => vaultCall(() => resolvePath(scope, query.path, query.sha256)),
    {
      vault: { action: 'read', fields: [] },
      query: resolveQuery,
      response: { 200: ResolveResponse, ...commonErrors },
      detail: {
        summary: 'Find where a file is now',
        description:
          'The current path of a file a reference stored as path and sha256: the path while it exists, else where the file was moved to, else a file with the same content. null when none is found.',
      },
    },
  )
  .get(
    '/knowledge/wikilink',
    ({ scope, paths, query }) => resolveWikilink(scope, paths.from, query.target),
    {
      vault: { action: 'read', fields: ['from'] },
      query: wikilinkQuery,
      response: { 200: ResolveResponse, ...commonErrors },
      detail: {
        summary: 'Find the file a wikilink points to',
        description:
          'The readable file whose name the target of [[target]] matches, preferring the folder and then the project of the note the link is in. null when none matches.',
      },
    },
  );
