import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { errors } from '#shared/responses';
import { ProjectMailAccountResponse } from './model';
import { getProjectMailAccount } from './service';

export const projectMailAccountRoutes = new Elysia({
  name: 'project-mail-accounts',
  detail: { tags: ['Connections'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/mail-account',
    ({ project, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return getProjectMailAccount(project.id);
    },
    {
      permission: ['integrations', 'read'],
      response: { 200: t.Nullable(ProjectMailAccountResponse), ...errors(401, 403, 404) },
      detail: {
        summary: 'Get the mail account assigned to a project',
        description:
          'Return the stored account identity and its separately probed connection status without credentials.',
      },
    },
  );
