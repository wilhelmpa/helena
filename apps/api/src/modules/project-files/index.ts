import { fileReferences } from './references';
import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { knowledgeActor } from '#modules/knowledge/reach';
import { canAccess, vaultScope } from '#modules/knowledge/scope';
import { isMcpRequest } from '#shared/mcp-request';
import { requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { getStorageSettings, MB } from '#modules/settings/service';
import {
  createFolderBody,
  createTextBody,
  updateTextBody,
  FileItemsResponse,
  FileReferencesResponse,
  FileListResponse,
  FilePathResponse,
  FileTextResponse,
  homeEntryQuery,
  homeFilesQuery,
  homeRawQuery,
  homeRootQuery,
  moveBody,
  projectEntryQuery,
  projectFilesQuery,
  projectRawQuery,
  uploadBody,
} from './model';
import { homeRoot, projectRoot, type HomeRootName } from './roots';
import {
  createFolder,
  createTextFile,
  updateTextFile,
  fileResponse,
  listFolder,
  moveEntry,
  readTextFile,
  trashEntry,
  uploadFiles,
} from './service';

const maxUploadBytes = async () => (await getStorageSettings()).maxAttachmentMb * MB;

// Two sets of routes over the same operations. The project routes browse the project's
// vault folder ("vault") and its workspace ("code", read-only) under the documents
// permissions. The home routes browse Home/, Templates/ and Private/ of the vault;
// Private/ is the instance owner's alone.
export const projectFileRoutes = new Elysia({
  name: 'project-files',
  detail: { tags: ['Files'] },
})
  .use(authContext)
  .use(guards)
  .macro({
    homeRoot(_enabled: boolean) {
      return {
        async resolve({ query, user, request }) {
          const current = requireUser(user);
          const name = (query as { root: HomeRootName }).root;
          const fileRoot = homeRoot(name);
          const scope = await vaultScope(current, isMcpRequest(request.headers), request.headers);
          const action = request.method === 'GET' ? 'read' : 'write';
          if (!canAccess(scope, fileRoot.vaultPath!, action)) {
            throw new HttpError(403, 'This folder is outside your vault access');
          }
          return { fileRoot, fileActor: scope.actor };
        },
      };
    },
  })
  .get(
    '/projects/:projectKey/files',
    ({ project, query }) => listFolder(projectRoot(project.key, query.root), query.path),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectFilesQuery,
      response: { 200: FileListResponse, ...commonErrors },
      detail: {
        summary: 'List project files',
        description:
          "List one folder of the project's vault folder, or of its workspace with root=code.",
      },
    },
  )
  .get(
    '/projects/:projectKey/files/references',
    ({ project, query, user, request }) =>
      fileReferences(
        projectRoot(project.key, query.root),
        query.path,
        requireUser(user),
        isMcpRequest(request.headers),
      ),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectRawQuery,
      response: { 200: FileReferencesResponse, ...commonErrors },
      detail: { summary: 'File author, task links and your conversations' },
    },
  )
  .get(
    '/projects/:projectKey/files/text',
    ({ project, query }) => readTextFile(projectRoot(project.key, query.root), query.path),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectRawQuery,
      response: { 200: FileTextResponse, ...commonErrors, ...errors(413) },
      detail: {
        summary: 'Read a project text file',
        description: 'Read a bounded .txt, .md, or .markdown file.',
      },
    },
  )
  .get(
    '/projects/:projectKey/files/raw',
    ({ project, query, request }) =>
      fileResponse(
        projectRoot(project.key, query.root),
        query.path,
        request,
        query.download != null,
      ),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectRawQuery,
      response: { ...commonErrors },
      detail: {
        summary: 'Open or download a project file',
        description:
          'Stream a file. PDF, raster images, audio, video and text open inline unless download is set; everything else is a download.',
      },
    },
  )
  .put(
    '/projects/:projectKey/files/text',
    async ({ project, body, user, request }) =>
      updateTextFile(
        projectRoot(project.key),
        body.path,
        body.content,
        body.expectedEtag,
        await knowledgeActor(requireUser(user), request.headers),
      ),
    {
      permission: ['documents', 'edit'],
      feature: 'documents',
      body: updateTextBody,
      response: { 200: FileTextResponse, ...commonErrors, ...errors(409, 413) },
      detail: { summary: 'Edit a project text file with a version check' },
    },
  )
  .post(
    '/projects/:projectKey/files/text',
    async ({ project, body, set, user, request }) => {
      set.status = 201;
      return createTextFile(
        projectRoot(project.key),
        body.path,
        body.content,
        await knowledgeActor(requireUser(user), request.headers),
      );
    },
    {
      permission: ['documents', 'create'],
      feature: 'documents',
      body: createTextBody,
      response: { 201: FilePathResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Create a project text file',
        description:
          'Create a new bounded .txt, .md, .markdown, .canvas, or .base file. Existing files are never overwritten.',
      },
    },
  )
  .post(
    '/projects/:projectKey/files/folders',
    ({ project, body, set }) => {
      set.status = 201;
      return createFolder(projectRoot(project.key), body.path);
    },
    {
      permission: ['documents', 'create'],
      feature: 'documents',
      body: createFolderBody,
      response: { 201: FilePathResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Create a project folder' },
    },
  )
  .post(
    '/projects/:projectKey/files/upload',
    async ({ project, query, body, set, user, request }) => {
      set.status = 201;
      return uploadFiles(
        projectRoot(project.key, query.root),
        query.path ?? '',
        body.files,
        await maxUploadBytes(),
        await knowledgeActor(requireUser(user), request.headers),
      );
    },
    {
      permission: ['documents', 'create'],
      feature: 'documents',
      query: projectFilesQuery,
      body: uploadBody,
      response: { 201: FileItemsResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Upload project files',
        description: 'Store files in a folder. A name that is taken gets a number: "name (2)".',
      },
    },
  )
  .post(
    '/projects/:projectKey/files/move',
    async ({ project, body, user, request }) =>
      moveEntry(
        projectRoot(project.key),
        body.from,
        body.to,
        await knowledgeActor(requireUser(user), request.headers),
      ),
    {
      permission: ['documents', 'edit'],
      feature: 'documents',
      body: moveBody,
      response: { 200: FilePathResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Rename or move a project file or folder',
        description: 'Attachments that point at the moved entry follow it.',
      },
    },
  )
  .delete(
    '/projects/:projectKey/files',
    async ({ project, query, user, request }) => {
      await trashEntry(
        projectRoot(project.key),
        query.path,
        await knowledgeActor(requireUser(user), request.headers),
      );
      return noContent();
    },
    {
      permission: ['documents', 'delete'],
      feature: 'documents',
      query: projectEntryQuery,
      response: { 204: t.Void(), ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Move a project file or folder to the trash',
        description: "Moves the entry to the vault's .trash folder at the same relative path.",
      },
    },
  )
  .get('/files', ({ fileRoot, query }) => listFolder(fileRoot, query.path), {
    homeRoot: true,
    query: homeFilesQuery,
    response: { 200: FileListResponse, ...commonErrors },
    detail: { summary: 'List Home, Templates or Private files' },
  })
  .get(
    '/files/references',
    ({ fileRoot, query, user, request }) =>
      fileReferences(fileRoot, query.path, requireUser(user), isMcpRequest(request.headers)),
    {
      homeRoot: true,
      query: homeRawQuery,
      response: { 200: FileReferencesResponse, ...commonErrors },
      detail: { summary: 'File author and your conversations' },
    },
  )
  .get('/files/text', ({ fileRoot, query }) => readTextFile(fileRoot, query.path), {
    homeRoot: true,
    query: homeRawQuery,
    response: { 200: FileTextResponse, ...commonErrors, ...errors(413) },
    detail: { summary: 'Read a Home, Templates or Private text file' },
  })
  .get(
    '/files/raw',
    ({ fileRoot, query, request }) =>
      fileResponse(fileRoot, query.path, request, query.download != null),
    {
      homeRoot: true,
      query: homeRawQuery,
      response: { ...commonErrors },
      detail: { summary: 'Open or download a Home, Templates or Private file' },
    },
  )
  .put(
    '/files/text',
    ({ fileRoot, fileActor, body }) =>
      updateTextFile(fileRoot, body.path, body.content, body.expectedEtag, fileActor),
    {
      homeRoot: true,
      query: homeRootQuery,
      body: updateTextBody,
      response: { 200: FileTextResponse, ...commonErrors, ...errors(409, 413) },
      detail: { summary: 'Edit a Home, Templates or Private text file with a version check' },
    },
  )
  .post(
    '/files/text',
    ({ fileRoot, fileActor, body, set }) => {
      set.status = 201;
      return createTextFile(fileRoot, body.path, body.content, fileActor);
    },
    {
      homeRoot: true,
      query: homeRootQuery,
      body: createTextBody,
      response: { 201: FilePathResponse, ...commonErrors, ...errors(409, 413) },
      detail: { summary: 'Create a Home, Templates or Private text file' },
    },
  )
  .post(
    '/files/folders',
    ({ fileRoot, body, set }) => {
      set.status = 201;
      return createFolder(fileRoot, body.path);
    },
    {
      homeRoot: true,
      query: homeRootQuery,
      body: createFolderBody,
      response: { 201: FilePathResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Create a Home, Templates or Private folder' },
    },
  )
  .post(
    '/files/upload',
    async ({ fileRoot, fileActor, query, body, set }) => {
      set.status = 201;
      return uploadFiles(fileRoot, query.path ?? '', body.files, await maxUploadBytes(), fileActor);
    },
    {
      homeRoot: true,
      query: homeFilesQuery,
      body: uploadBody,
      response: { 201: FileItemsResponse, ...commonErrors, ...errors(409, 413) },
      detail: { summary: 'Upload Home, Templates or Private files' },
    },
  )
  .post(
    '/files/move',
    ({ fileRoot, fileActor, body }) => moveEntry(fileRoot, body.from, body.to, fileActor),
    {
      homeRoot: true,
      query: homeRootQuery,
      body: moveBody,
      response: { 200: FilePathResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Rename or move a Home, Templates or Private file or folder' },
    },
  )
  .delete(
    '/files',
    async ({ fileRoot, fileActor, query }) => {
      await trashEntry(fileRoot, query.path, fileActor);
      return noContent();
    },
    {
      homeRoot: true,
      query: homeEntryQuery,
      response: { 204: t.Void(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Move a Home, Templates or Private file or folder to the trash' },
    },
  );
