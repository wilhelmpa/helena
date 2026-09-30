import { workFromHeaders } from './provenance';
import { ownerToolsRuntime } from '#modules/owner-terminal/ava-tools';
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
  .get('/god/root-access', () => rootSettings(), {
    rootOwner: true,
    detail: {
      summary: 'Read the root access settings',
      description:
        "Whether the Home agent may run root commands (the owner's revocation switch) and " +
        'how its requests are handled.',
    },
  })
  .put('/god/root-access', ({ body, owner }) => setRootSettings(body, owner.id), {
    rootOwner: true,
    body: rootSettingsBody,
    detail: {
      summary: 'Change the root access settings',
      description: 'Turn root access for the Home agent on or off. Only the owner can change it.',
    },
  })
  .get('/god/root-access/audit', () => rootAudit(), {
    rootOwner: true,
    detail: {
      summary: 'Read the root access audit',
      description:
        'The non-blocking audit log of root commands: who asked, the command, its origin and outcome.',
    },
  })
  .post(
    '/agent-root',
    ({ agent, request, body }) =>
      requestRoot(
        agent,
        ownerToolsRuntime(request)
          ? { runtime: ownerToolsRuntime(request), ownerTerminal: true }
          : workFromHeaders(agent.id, request.headers),
        body,
      ),
    {
      runnerAgent: true,
      body: rootCommandBody,
      detail: {
        summary: 'Run a root command for the Home agent',
        description:
          'Run a root command with its reason. Home work on every runtime runs immediately when unrestricted mode is enabled. Provenance and results remain audited; the owner can revoke access.',
        ...mcpTool('run_as_root', undefined, 'report'),
      },
    },
  );
