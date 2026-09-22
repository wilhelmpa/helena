import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { commonErrors } from '#shared/responses';
import {
  createProjectTextBody,
  ProjectFileCreatedResponse,
  ProjectFileListResponse,
  ProjectFileTextResponse,
  projectFilesQuery,
} from './model';
import {
  createProjectText,
  downloadProjectFile,
  listProjectFiles,
  readProjectText,
} from './service';

export const projectFileRoutes = new Elysia({
  name: 'project-files',
  detail: { tags: ['Files'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/files',
    ({ project, query }) => listProjectFiles(project.key, query.path),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectFilesQuery,
      response: { 200: ProjectFileListResponse, ...commonErrors },
      detail: {
        summary: 'List project files',
        description:
          'List one folder inside the project-scoped Nextcloud root without exposing provider credentials or URLs.',
      },
    },
  )
  .get(
    '/projects/:projectKey/files/text',
    ({ project, query }) => readProjectText(project.key, query.path ?? ''),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectFilesQuery,
      response: { 200: ProjectFileTextResponse, ...commonErrors },
      detail: {
        summary: 'Read a project text file',
        description: 'Read a bounded .txt, .md, or .markdown file from the project file root.',
      },
    },
  )
  .post(
    '/projects/:projectKey/files/text',
    ({ project, body, set }) => {
      set.status = 201;
      return createProjectText(project.key, body.path, body.content);
    },
    {
      permission: ['documents', 'create'],
      feature: 'documents',
      body: createProjectTextBody,
      response: { 201: ProjectFileCreatedResponse, ...commonErrors },
      detail: {
        summary: 'Create a project text file',
        description:
          'Create a new bounded .txt, .md, or .markdown file. Existing files are never overwritten.',
      },
    },
  )
  .get(
    '/projects/:projectKey/files/download',
    ({ project, query }) => downloadProjectFile(project.key, query.path ?? ''),
    {
      permission: ['documents', 'read'],
      feature: 'documents',
      query: projectFilesQuery,
      response: { ...commonErrors },
      detail: {
        summary: 'Download a project file',
        description:
          'Stream a bounded file through the authenticated Plan API without exposing a provider URL or credential.',
      },
    },
  );
