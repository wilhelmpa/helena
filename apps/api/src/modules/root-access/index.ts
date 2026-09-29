import { workFromHeaders } from './provenance';
import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { mcpTool } from '#mcp/generate';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import { runnerAuth } from '#modules/agents/runner-auth';
import { rootCommandBody, rootSettingsBody } from './model';
import { requestRoot, rootAudit, rootSettings, setRootSettings } from './service';

export const rootAccessRoutes = new Elysia({ name: 'volition-root-access' })
  .use(authContext)
  .use(runnerAuth)
  .macro({
    rootOwner: {
      async resolve({ user, request }) {
        const owner = requireGod(user);
        await requireInteractiveOwner(request, owner.id);
        return { owner };
      },
    },
  })
  .get('/god/root-access', () => rootSettings(), { rootOwner: true })
  .put('/god/root-access', ({ body, owner }) => setRootSettings(body, owner.id), {
    rootOwner: true,
    body: rootSettingsBody,
  })
  .get('/god/root-access/audit', () => rootAudit(), { rootOwner: true })
  .post(
    '/agent-root',
    ({ agent, request, body }) =>
      requestRoot(agent, workFromHeaders(agent.id, request.headers), body),
    {
      runnerAgent: true,
      body: rootCommandBody,
      detail: {
        summary: 'Run a root command for the Home agent',
        description:
          'Run a root command with its reason. Untrusted or unobservable work creates an owner approval; approval executes the stored command. The result is recorded under Administrator / Security.',
        ...mcpTool('run_as_root', undefined, 'report'),
      },
    },
  );
