import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { Elysia } from 'elysia';
import { aiAgent, db, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { getSessionFromHeaders } from '@repo/auth';
import { HttpError } from '#shared/lib';
import { HOME_SLUG } from '#shared/agent-socket';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { getRunnerAgent, type RunnerAgent } from '../agents/runner/service';
import { loginCode, loginForOrigin } from './credentials';
import {
  browserGatewayEnabledForAgent,
  browserGatewayPolicies,
  getBrowserGatewaySettings,
  projectBySlug,
} from './service';
import { DEFAULT_BROWSER_GATEWAY_SETTINGS } from './model';
import { recordBrowserGatewayEvent } from './events';
import { fileHandoverCard, resolveHandoverCard } from './handover';
import { MAX_DOWNLOAD_BYTES, saveDownload } from './downloads';
import { decideBrowserAction, fileBrowserApproval, isActionCategory } from './policy';
import { effectiveBrowserControl } from '#modules/browser-task/settings';
import {
  finishTask,
  openAgentTask,
  openLabTask,
  taskByToken,
  taskProgress,
  taskSystemOne,
} from '#modules/browser-task/runs';

// A secret must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there.
function secretModeMask(file: string): number {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

// The gateway's own routes (design §3: "prüft bei Plan: Agent, Projekt, Browser-Recht,
// Login-Freigaben (internes API, Service-Token)"). Two factors, like the agent-egress proxy
// and the agent-isolation launcher before it: a service token of the gateway's own
// (BROWSER_GATEWAY_TOKEN_FILE — the gateway holds no other control credential) proves the
// caller is the gateway process itself, and the agentKey it forwards proves which agent it
// acts for — the same key that agent presents everywhere else, resolved through the normal
// session/agent lookup, so there is one place that decides whether a key is valid.
//
// Every call also names `via`: the project browser socket it came through, which the kernel
// decided (the isolation launcher binds one socket per project into an agent's unit). Only
// the Home-Master calls through Home's socket, and only through it may another project be
// named — checked here again, not trusted from the gateway alone.

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

let tokenPromise: Promise<string> | null = null;
let tokenPath: string | null = null;

async function gatewayToken(): Promise<string> {
  const tokenFile = process.env.BROWSER_GATEWAY_TOKEN_FILE?.trim();
  if (!tokenFile) throw new Error('no browser gateway token configured');
  if (tokenPath !== tokenFile) {
    tokenPath = tokenFile;
    tokenPromise = null;
  }
  tokenPromise ??= lstat(tokenFile)
    .then(async (stat) => {
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & secretModeMask(tokenFile)) !== 0
      ) {
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

// Resolves the same way any other x-api-key caller does (getSessionFromHeaders) and then the
// same agent lookup the runner itself uses (getRunnerAgent).
async function agentByKey(agentKey: string): Promise<RunnerAgent | null> {
  if (!agentKey) return null;
  // A Browser 2.0 run (docs/helena-decisions/browser-task.md §3.5): the owner started it as one
  // of the project's agents; the gateway carries the run's one-time token instead of that
  // agent's key, and everything below (grants, project, policy, approvals) is that agent's.
  if (agentKey.startsWith('lab:')) {
    const run = await taskByToken(agentKey.slice(4));
    if (!run || run.source !== 'lab' || !run.agentId) return null;
    const [row] = await db
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(eq(aiAgent.id, run.agentId));
    return row ? getRunnerAgent(row.userId) : null;
  }
  const headers = new Headers({ 'x-api-key': agentKey });
  const session = await getSessionFromHeaders(headers);
  if (!session || session.user.active === false) return null;
  // Every agent runs on a runner (ai_agent.kind is always 'external').
  return getRunnerAgent(session.user.id);
}

// The name people know an agent by ("Coder VOL"), for the live view's "Steuert: …" and the
// audit; its handle when it has none.
async function displayName(agent: RunnerAgent): Promise<string> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, agent.userId));
  return row?.name?.trim() || agent.username;
}

interface Target {
  // Null for Home's own browser, which belongs to no project.
  project: { id: number; key: string } | null;
}

// Who may act on which browser, through which socket:
// - through Home's socket only the Home-Master, on Home's browser or any project it works in;
// - through a project's socket only an agent of that project, on that project's browser.
export async function authorizeTarget(
  agent: RunnerAgent,
  targetSlug: unknown,
  via: unknown,
): Promise<Target> {
  if (typeof targetSlug !== 'string' || !SLUG.test(targetSlug)) {
    throw new HttpError(400, 'Invalid project');
  }
  if (typeof via !== 'string' || !SLUG.test(via)) throw new HttpError(400, 'Invalid socket');
  const homeAgent = isHomeAgent(agent.username);
  if (via === HOME_SLUG) {
    if (!homeAgent) throw new HttpError(403, "Only the Home-Master uses Home's browser");
  } else {
    if (homeAgent) throw new HttpError(403, "The Home-Master uses Home's browser gateway");
    if (targetSlug !== via)
      throw new HttpError(403, 'Only the Home-Master may act on another project');
  }
  if (targetSlug === HOME_SLUG) return { project: null };
  const project = await projectBySlug(targetSlug);
  if (!project) throw new HttpError(404, 'Project not found');
  if (!agent.projects.some((row) => row.key === project.key)) {
    throw new HttpError(403, 'Agent does not work in this project');
  }
  return { project };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function optionalId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

// One place for the shape every route shares: the token, a JSON body, and an HttpError
// thrown anywhere below answered as JSON.
function route(
  handler: (body: Record<string, unknown>) => Promise<unknown>,
): (context: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const refused = await denied(request);
    if (refused) return refused;
    const body = await readJson(request);
    if (!body) return privateJson({ error: 'Invalid request' }, 400);
    try {
      return privateJson(await handler(body));
    } catch (error) {
      if (error instanceof HttpError) return privateJson({ error: error.message }, error.status);
      throw error;
    }
  };
}

async function requireAgent(body: Record<string, unknown>): Promise<RunnerAgent> {
  if (typeof body.agentKey !== 'string') throw new HttpError(400, 'Invalid request');
  const agent = await agentByKey(body.agentKey);
  if (!agent) throw new HttpError(403, 'Unknown agent key');
  return agent;
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
    route(async (body) => {
      const agent = await requireAgent(body);
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      const [enabled, settings, control] = await Promise.all([
        browserGatewayEnabledForAgent(agent.id, agent.teamId),
        project ? getBrowserGatewaySettings(project.id) : { ...DEFAULT_BROWSER_GATEWAY_SETTINGS },
        effectiveBrowserControl({ teamId: agent.teamId, projectId: project?.id ?? null }),
      ]);
      const lab =
        typeof body.agentKey === 'string' && body.agentKey.startsWith('lab:')
          ? await taskByToken(body.agentKey.slice(4))
          : null;
      return {
        agentId: agent.id,
        agentName: await displayName(agent),
        teamId: agent.teamId,
        projectId: project?.id ?? null,
        projectKey: project?.key ?? null,
        browserGatewayEnabled: enabled,
        settings,
        // A Browser 2.0 run tests the connection the owner picked, whatever the project's
        // own setting says.
        browserTask: lab
          ? {
              enabled: lab.backend === 'decision',
              policy:
                lab.policy === 'laya' ? 'laya' : lab.policy === 'jev' ? 'jev' : control.policy,
              minConfidence: control.minConfidence,
              label: lab.backendLabel,
            }
          : {
              enabled: control.enabled,
              policy: control.policy,
              minConfidence: control.minConfidence,
              label: control.label,
            },
      };
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/login',
    route(async (body) => {
      const agent = await requireAgent(body);
      if (typeof body.frameOrigin !== 'string') throw new HttpError(400, 'Invalid request');
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      return loginForOrigin(
        agent,
        { runId: optionalId(body.runId), messageId: optionalId(body.messageId) },
        project?.id ?? null,
        body.frameOrigin,
        optionalId(body.credentialId),
      );
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/login-code',
    route(async (body) => {
      const agent = await requireAgent(body);
      const credentialId = optionalId(body.credentialId);
      if (credentialId === undefined || typeof body.frameOrigin !== 'string') {
        throw new HttpError(400, 'Invalid request');
      }
      // A gateway older than the project in this call names none: then a grant to any
      // project the agent works in counts, as for a chat answer.
      const project =
        body.projectSlug === undefined
          ? null
          : (await authorizeTarget(agent, body.projectSlug, body.via)).project;
      return loginCode(
        agent,
        { runId: optionalId(body.runId), messageId: optionalId(body.messageId) },
        project?.id ?? null,
        credentialId,
        body.frameOrigin,
      );
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/audit',
    route(async (body) => {
      const agent = await requireAgent(body);
      if (typeof body.tool !== 'string' || !/^browser_[a-z_]{1,40}$/.test(body.tool)) {
        throw new HttpError(400, 'Invalid request');
      }
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      await recordBrowserGatewayEvent({
        projectId: project?.id ?? null,
        agentId: agent.id,
        agentName: await displayName(agent),
        actor: 'agent',
        tool: body.tool,
        category: isActionCategory(body.category) ? body.category : null,
        target: typeof body.target === 'string' ? body.target.slice(0, 300) : null,
      });
      return { stored: true };
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/decide',
    route(async (body) => {
      const agent = await requireAgent(body);
      if (!isActionCategory(body.category) || typeof body.tool !== 'string') {
        throw new HttpError(400, 'Invalid request');
      }
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      const raw = (body.context ?? {}) as Record<string, unknown>;
      const text = (value: unknown, max = 300) =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
      const context = {
        tool: body.tool.slice(0, 64),
        origin: text(raw.origin),
        target: text(raw.target),
        element: text(raw.element, 120),
        formAction: text(raw.formAction),
        groundedElement: text(raw.groundedElement),
        pagePath: text(raw.pagePath, 600),
      };
      const decided = await decideBrowserAction(agent, project, body.category, context, {
        runId: optionalId(body.runId) ?? null,
        messageId: optionalId(body.messageId) ?? null,
      });
      if (decided.effect !== 'needs-approval') {
        return { effect: decided.effect, reason: decided.reason };
      }
      if (!project) {
        return {
          effect: 'deny',
          reason: "it needs an approval, which Home's own browser cannot ask for",
        };
      }
      return {
        effect: 'needs-approval',
        reason: decided.reason,
        approvalId: await fileBrowserApproval(
          agent,
          project,
          body.category,
          context,
          decided.reason,
        ),
      };
    }),
    { detail: { hide: true } },
  )
  // browser_task (docs/helena-decisions/browser-task.md §3.4): a task opens a row and gets the
  // token its decisions travel under; Helena makes each System One call with the project's
  // connection and key; steps and the result are stored and counted.
  .post(
    '/internal/browser-gateway/task/start',
    route(async (body) => {
      const agent = await requireAgent(body);
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      const control = await effectiveBrowserControl({
        teamId: agent.teamId,
        projectId: project?.id ?? null,
      });
      if (typeof body.agentKey === 'string' && body.agentKey.startsWith('lab:')) {
        return openLabTask(body.agentKey.slice(4), control);
      }
      const kind = body.kind === 'check' || body.kind === 'choose' ? body.kind : 'task';
      const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
      if (!goal) throw new HttpError(400, 'Invalid request');
      const maxSteps =
        typeof body.maxSteps === 'number' && Number.isFinite(body.maxSteps)
          ? Math.max(1, Math.min(60, Math.floor(body.maxSteps)))
          : 20;
      return openAgentTask({
        agentId: agent.id,
        teamId: agent.teamId,
        projectId: project?.id ?? null,
        kind,
        goal,
        mode: body.mode === 'read' ? 'read' : 'act',
        maxSteps,
        startUrl: typeof body.startUrl === 'string' ? body.startUrl : null,
        runId: optionalId(body.runId) ?? null,
        chatMessageId: optionalId(body.messageId) ?? null,
        control,
      });
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/systemone',
    route(async (body) => {
      if (!body.questions || typeof body.questions !== 'object' || Array.isArray(body.questions)) {
        throw new HttpError(400, 'Invalid request');
      }
      return taskSystemOne(body.taskToken, {
        state: body.state,
        questions: body.questions as Record<string, unknown>,
      });
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/task/progress',
    route(async (body) => taskProgress(body.taskToken, body.step)),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/task/finish',
    route(async (body) => {
      await finishTask(body.taskToken, body.result);
      return { stored: true };
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/handover',
    route(async (body) => {
      const agent = await requireAgent(body);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
      if (!reason) throw new HttpError(400, 'Invalid request');
      const { project } = await authorizeTarget(agent, body.projectSlug, body.via);
      // Home's own browser has no project to file a card under; its live view shows the
      // request all the same.
      if (!project) return { approvalId: null };
      return { approvalId: await fileHandoverCard(agent, project, reason) };
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/handover-done',
    route(async (body) => {
      const approvalId = optionalId(body.approvalId);
      if (approvalId === undefined || typeof body.finished !== 'boolean') {
        throw new HttpError(400, 'Invalid request');
      }
      await resolveHandoverCard(approvalId, body.finished);
      return { stored: true };
    }),
    { detail: { hide: true } },
  )
  .post(
    '/internal/browser-gateway/download',
    route(async (body) => {
      if (typeof body.projectSlug !== 'string' || !SLUG.test(body.projectSlug)) {
        throw new HttpError(400, 'Invalid project');
      }
      if (typeof body.fileName !== 'string' || typeof body.data !== 'string') {
        throw new HttpError(400, 'Invalid request');
      }
      // The browser's own download, whoever caused it (an agent, or the owner in the live
      // view): the gateway's token is what authorizes it; the agent only names who acted.
      const agent = typeof body.agentKey === 'string' ? await agentByKey(body.agentKey) : null;
      const bytes = Buffer.from(body.data, 'base64');
      if (bytes.length > MAX_DOWNLOAD_BYTES) throw new HttpError(413, 'The download is too large');
      const project = body.projectSlug === HOME_SLUG ? null : await projectBySlug(body.projectSlug);
      if (body.projectSlug !== HOME_SLUG && !project) throw new HttpError(404, 'Project not found');
      const path = await saveDownload(project, body.fileName, bytes);
      await recordBrowserGatewayEvent({
        projectId: project?.id ?? null,
        agentId: agent?.id ?? null,
        agentName: agent ? await displayName(agent) : '',
        actor: agent ? 'agent' : 'owner',
        tool: 'browser_download',
        // A file taken off the web into the project: the framework's 'execute' category.
        category: 'execute',
        target: path.slice(0, 300),
      });
      return { path };
    }),
    { detail: { hide: true } },
  );
