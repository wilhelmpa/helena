import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { Elysia } from 'elysia';
import { db, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { getSessionFromHeaders } from '@repo/auth';
import { HttpError } from '#shared/lib';
import { getRunnerAgent, type RunnerAgent } from '../agents/runner/service';
import { loginCode, loginForOrigin } from './credentials';
import {
  browserGatewayEnabledForAgent,
  browserGatewayPolicies,
  getBrowserGatewaySettings,
} from './service';
import { recordBrowserGatewayEvent } from './events';

// The gateway's own routes (design §3: "prüft bei Plan: Agent, Projekt, Browser-Recht,
// Login-Freigaben (internes API, Service-Token)"). Two factors, like the agent-egress proxy
// and the agent-isolation launcher before it: a service token of the gateway's own
// (BROWSER_GATEWAY_TOKEN_FILE — the gateway holds no other control credential, same shape
// as AGENT_EGRESS_TOKEN_FILE) proves the caller is the gateway process itself, and the
// agentKey it forwards proves which agent it is acting for — the same key that agent
// presents everywhere else (x-api-key), resolved through the normal session/agent lookup so
// there is exactly one place that decides whether a key is valid.

let tokenPromise: Promise<string> | null = null;

async function gatewayToken(): Promise<string> {
  const tokenFile = process.env.BROWSER_GATEWAY_TOKEN_FILE?.trim();
  if (!tokenFile) throw new Error('no browser gateway token configured');
  tokenPromise ??= lstat(tokenFile)
    .then(async (stat) => {
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw new Error('invalid secret file');
      }
      const token = (await readFile(tokenFile, 'utf8')).trim();
      if (Buffer.byteLength(token) < 32 || token.length > 2048) throw new Error('invalid token');
      return token;
    })
    .catch((error) => {
      tokenPromise = null;
      throw error;
    });
  return tokenPromise;
}

async function denied(request: Request): Promise<Response | null> {
  const authorization = request.headers.get('authorization') ?? '';
  const given = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  let expected: Buffer;
  try {
    expected = Buffer.from(await gatewayToken());
  } catch {
    return new Response('Browser gateway unavailable', { status: 503 });
  }
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? null
    : new Response('Unauthorized', { status: 401 });
}

function privateJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Resolves the same way any other x-api-key caller does (getSessionFromHeaders, the same
// function the normal HTTP path and the agent socket use) and then the same agent lookup
// the runner itself uses (getRunnerAgent) — no separate credential store for the gateway.
async function agentByKey(agentKey: string): Promise<RunnerAgent | null> {
  const headers = new Headers({ 'x-api-key': agentKey });
  const session = await getSessionFromHeaders(headers);
  if (!session || session.user.active === false) return null;
  const agent = await getRunnerAgent(session.user.id);
  if (!agent || agent.kind !== 'external') return null;
  return agent;
}

async function projectByKey(key: string): Promise<{ id: number } | null> {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.key, key));
  return row ?? null;
}

function agentProject(agent: RunnerAgent, projectKey: string) {
  return agent.projects.find((row) => row.key === projectKey);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const agentBrowserGatewayInternalRoutes = new Elysia({
  name: 'agent-browser-gateway-internal',
})
  .get(
    '/internal/browser-gateway/policy',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      return privateJson({ schemaVersion: 1, projects: await browserGatewayPolicies() });
    },
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/resolve',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      const body = await readJson(request);
      if (!body || typeof body.agentKey !== 'string' || typeof body.projectKey !== 'string') {
        return privateJson({ error: 'Invalid request' }, 400);
      }
      const agent = await agentByKey(body.agentKey);
      if (!agent) return privateJson({ error: 'Unknown agent key' }, 403);
      const membership = agentProject(agent, body.projectKey);
      if (!membership) return privateJson({ error: 'Agent does not work in this project' }, 403);
      const proj = await projectByKey(body.projectKey);
      if (!proj) return privateJson({ error: 'Project not found' }, 404);
      const [enabled, settings] = await Promise.all([
        browserGatewayEnabledForAgent(agent.id, agent.teamId),
        getBrowserGatewaySettings(proj.id),
      ]);
      return privateJson({
        agentId: agent.id,
        agentName: agent.username,
        teamId: agent.teamId,
        projectId: proj.id,
        browserGatewayEnabled: enabled,
        settings,
      });
    },
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/login',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      const body = await readJson(request);
      if (
        !body ||
        typeof body.agentKey !== 'string' ||
        typeof body.projectKey !== 'string' ||
        typeof body.frameOrigin !== 'string'
      ) {
        return privateJson({ error: 'Invalid request' }, 400);
      }
      const agent = await agentByKey(body.agentKey);
      if (!agent) return privateJson({ error: 'Unknown agent key' }, 403);
      const proj = await projectByKey(body.projectKey);
      if (!proj || !agentProject(agent, body.projectKey)) {
        return privateJson({ error: 'Agent does not work in this project' }, 403);
      }
      try {
        const result = await loginForOrigin(
          agent,
          {
            runId: body.runId as number | undefined,
            messageId: body.messageId as number | undefined,
          },
          proj.id,
          body.frameOrigin,
          body.credentialId as number | undefined,
        );
        return privateJson(result);
      } catch (error) {
        if (error instanceof HttpError) return privateJson({ error: error.message }, error.status);
        throw error;
      }
    },
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/login-code',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      const body = await readJson(request);
      if (!body || typeof body.agentKey !== 'string' || typeof body.credentialId !== 'number') {
        return privateJson({ error: 'Invalid request' }, 400);
      }
      const agent = await agentByKey(body.agentKey);
      if (!agent) return privateJson({ error: 'Unknown agent key' }, 403);
      try {
        const result = await loginCode(
          agent,
          {
            runId: body.runId as number | undefined,
            messageId: body.messageId as number | undefined,
          },
          body.credentialId,
        );
        return privateJson(result);
      } catch (error) {
        if (error instanceof HttpError) return privateJson({ error: error.message }, error.status);
        throw error;
      }
    },
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/audit',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      const body = await readJson(request);
      if (
        !body ||
        typeof body.agentKey !== 'string' ||
        typeof body.projectKey !== 'string' ||
        typeof body.tool !== 'string' ||
        (body.actor !== 'agent' && body.actor !== 'owner')
      ) {
        return privateJson({ error: 'Invalid request' }, 400);
      }
      const agent = await agentByKey(body.agentKey);
      if (!agent) return privateJson({ error: 'Unknown agent key' }, 403);
      const proj = await projectByKey(body.projectKey);
      if (!proj || !agentProject(agent, body.projectKey)) {
        return privateJson({ error: 'Agent does not work in this project' }, 403);
      }
      await recordBrowserGatewayEvent({
        projectId: proj.id,
        agentId: agent.id,
        agentName: agent.username,
        actor: body.actor,
        tool: body.tool,
        target: typeof body.target === 'string' ? body.target.slice(0, 300) : null,
      });
      return privateJson({ stored: true });
    },
    { detail: { hide: true } },
  );
