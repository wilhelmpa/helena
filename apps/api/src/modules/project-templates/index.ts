import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { requireUser } from '#shared/access';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import {
  ApplyTemplateResponse,
  TemplateResponse,
  captureTemplateBody,
  templateParams,
  updateTemplateBody,
} from './model';
import {
  applyProjectTemplate,
  captureProjectTemplate,
  deleteProjectTemplate,
  listProjectTemplates,
  updateProjectTemplate,
} from './service';

export const projectTemplateRoutes = new Elysia({
  name: 'project-templates',
  detail: { tags: ['Project templates'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/project-templates',
    ({ project }) => listProjectTemplates(project.id),
    {
      projectMember: true,
      response: { 200: t.Array(TemplateResponse), ...accessErrors },
      detail: { summary: 'List reusable project and board templates' },
    },
  )
  .post(
    '/projects/:projectKey/project-templates',
    async ({ project, body, user, set }) => {
      set.status = 201;
      return captureProjectTemplate({
        projectId: project.id,
        createdBy: requireUser(user).id,
        ...body,
      });
    },
    {
      projectOwner: true,
      body: captureTemplateBody,
      response: { 201: TemplateResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Capture the current project as a reusable template' },
    },
  )
  .patch(
    '/projects/:projectKey/project-templates/:templateId',
    async ({ project, params, body }) => {
      const template = await updateProjectTemplate(project.id, params.templateId, body);
      if (!template) throw new HttpError(404, 'Project template not found');
      return template;
    },
    {
      projectOwner: true,
      params: templateParams,
      body: updateTemplateBody,
      response: { 200: TemplateResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Update a reusable project template' },
    },
  )
  .post(
    '/projects/:projectKey/project-templates/:templateId/apply',
    ({ project, params }) => applyProjectTemplate(project.id, params.templateId),
    {
      projectOwner: true,
      params: templateParams,
      response: { 200: ApplyTemplateResponse, ...commonErrors },
      detail: { summary: 'Apply a project or board template idempotently' },
    },
  )
  .delete(
    '/projects/:projectKey/project-templates/:templateId',
    async ({ project, params }) => {
      if (!(await deleteProjectTemplate(project.id, params.templateId)))
        throw new HttpError(404, 'Project template not found');
      return noContent();
    },
    {
      projectOwner: true,
      params: templateParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a reusable project template' },
    },
  );
