import {
  auth,
  getSessionFromHeaders,
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
  trustedOrigins,
  getAuthSettings,
  hasConfiguredGoogle,
  hasConfiguredOidc,
  getOidcLabel,
} from '@repo/auth';
import { hasConfiguredEmailProvider } from '@repo/db';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Elysia } from 'elysia';
import { planner } from './planner';
import { mountMcp } from './mcp/mount';
import { setMcpApp } from './mcp/app-ref';
import { gitWebhookRoutes } from './modules/git/webhook';
import { scimRoutes } from './modules/scim';
import { syncOidcGroupsAfterCallback } from './modules/scim/oidc-sync';
import { normalizeOpenApiResponse } from './openapi';
import { homeAgentBootstrapRoutes } from './home-agent-bootstrap';
import { hermesTeamControlRoutes } from './hermes-team-control';
import { agentEgressInternalRoutes } from './modules/agent-egress/internal';
import {
  agentSocketProject,
  agentSocketRequestAllowed,
  checkAgentSocket,
  hasApiKey,
} from './shared/agent-socket';
import { HttpError } from './shared/lib';
import { issueProxyToken } from './modules/owner-terminal/service';
import { OwnerTerminalKindParam, type OwnerTerminalKind } from './modules/owner-terminal/model';
import pkg from '../../../package.json';

const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const appUrl = (process.env.APP_URL?.split(',')[0]?.trim() || 'http://localhost:3001').replace(
  /\/+$/,
  '',
);
const apiDescription = `REST API for projects, work items, AI agents, Git integrations, analytics, and instance administration.

## Quick start

1. Create a personal API key in [Account settings](${appUrl}/account/api-keys). The key is shown once and carries the same permissions as its owner.
2. Send it in the \`x-api-key\` header. Never put a key in a URL, issue, comment, or source file.
3. Use the project key from the URL in routes containing \`{projectKey}\`. This page is opened from a project, but the API document is instance-wide.

\`\`\`sh
curl "${apiUrl}/projects" \\
  --header "x-api-key: YOUR_PERSONAL_API_KEY" # gitleaks:allow
\`\`\`

JSON errors use \`{ "error": "message" }\` and may also include a stable \`code\`. Pagination parameters and response envelopes are documented per operation.

For agent clients, use the MCP endpoint at [${apiUrl}/mcp](${apiUrl}/mcp). SCIM, worker-internal routes, and repository webhooks use the separate credentials shown on their operations.`;

// The assembled Elysia app, without `.listen()`. `index.ts` imports this and
// binds the port; tests import it and pass it to Eden Treaty to drive routes in
// memory (no network). Keep the chain unbroken so `type App` stays accurate.
export const app = new Elysia()
  // A request from an isolated agent (it names the agent's project, see
  // shared/agent-socket.ts) never reaches the host's control plane or the sign-in flows,
  // whatever the route would say about its credential.
  .onRequest(async ({ request }) => {
    try {
      if (!agentSocketRequestAllowed(request, new URL(request.url).pathname)) {
        return Response.json({ error: 'Not available to agents' }, { status: 403 });
      }
      // A key on the agent socket is checked here for every route, also the few outside
      // the planner that read a key themselves (/me); authContext and /mcp check it again.
      if (agentSocketProject(request.headers) !== null && hasApiKey(request.headers)) {
        const session = await getSessionFromHeaders(request.headers);
        if (session) await checkAgentSocket(request.headers, session.user.id);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 403;
      return Response.json({ error: 'Not available to this agent' }, { status });
    }
  })
  .use(
    cors({
      origin: trustedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    }),
  )
  .onAfterHandle({ as: 'global' }, ({ request, response }) =>
    normalizeOpenApiResponse(request, response),
  )
  .use(homeAgentBootstrapRoutes)
  .use(hermesTeamControlRoutes)
  .use(agentEgressInternalRoutes)
  // OpenAPI docs. Mounted on the main app (outside the planner's session guard)
  // so the UI at /docs and the spec at /docs/json are reachable without a
  // session. The spec is generated from the `t` schemas on every route.
  .use(
    swagger({
      path: '/docs',
      // Render with Scalar's own "default" theme to match the better-auth reference
      // at /api/auth/reference. `customCss: ""` drops the gradient theme that
      // @elysiajs/swagger injects by default (it falls back to elysiajsTheme only
      // when customCss is null/undefined).
      scalarConfig: {
        theme: 'default',
        customCss: '',
      },
      documentation: {
        info: {
          title: 'Helena API',
          version: pkg.version,
          description: apiDescription,
        },
        servers: [{ url: apiUrl, description: 'Configured public API origin' }],
        tags: [
          { name: 'Projects', description: 'Projects and the full work items view' },
          { name: 'Teams', description: 'Teams that own projects' },
          { name: 'Members', description: 'Project membership and roles' },
          { name: 'Roles', description: 'Project roles and their permissions' },
          { name: 'Invites', description: 'Project invites (create, accept, reject)' },
          { name: 'Columns', description: 'Work items columns and their order' },
          { name: 'Issue Types', description: 'Per-project issue types' },
          { name: 'Labels', description: 'Labels and label groups' },
          { name: 'AI Agents', description: 'AI agents attached to a project' },
          {
            name: 'Integrations',
            description: 'Stored integration credentials (LLM keys and tool creds)',
          },
          { name: 'Agent Skills', description: 'Skill library given to internal agents' },
          {
            name: 'Agent Runner',
            description: "Run queue an external agent's runner drains with the agent's API key",
          },
          {
            name: 'Agent Chat',
            description: "Chat with an external agent: the member's messages and its runner's feed",
          },
          {
            name: 'Chat Prompts',
            description: "The member's saved prompts for the chat composer",
          },
          {
            name: 'Agent Tools',
            description: 'Tools configured on a credential and given to agents',
          },
          {
            name: 'Agent MCP Servers',
            description: "The team's MCP server library and the servers enabled on each agent",
          },
          {
            name: 'Credentials',
            description: "The team's web logins, API keys, SSH keys and secrets, and their grants",
          },
          {
            name: 'Agent Learning',
            description:
              'What an external agent learned in its runtime, and the actions its runner ' +
              'carries out on it',
          },
          {
            name: 'Agent Runs',
            description: "A run's timeline, live and as a replay, and continuing its session",
          },
          {
            name: 'Agent Runtime',
            description:
              "What an agent's runtime keeps: sessions and transcripts, logs, health, " +
              'version, curator, read through its runner',
          },
          {
            name: 'Agent Usage',
            description: 'Tokens and cost of the agents per agent, model, project and day',
          },
          {
            name: 'Agent Proposals',
            description:
              "Changes an agent's runtime raised for the owner's decision: memory writes, " +
              'runtime updates',
          },
          { name: 'Emergency Stop', description: "The instance's emergency stop for all agents" },
          { name: 'Custom Fields', description: 'Global and type-scoped custom fields' },
          { name: 'Issue Templates', description: 'Presets a new issue can be created from' },
          { name: 'Issues', description: 'Issues, their fields, feed, and comments' },
          {
            name: 'Initiatives',
            description: 'Initiatives (issue groupings) and their activity feed',
          },
          { name: 'Cycles', description: 'Cycles (time-boxed periods of work) and their issues' },
          { name: 'Attachments', description: 'Issue attachments and raw bytes' },
          {
            name: 'Chat attachments',
            description: 'Files uploaded in an agent chat and their raw bytes',
          },
          { name: 'Imports', description: 'Import drafts that turn an uploaded file into issues' },
          { name: 'Avatars', description: "Current user's avatar image (upload and raw bytes)" },
          { name: 'Views', description: 'Saved work items views' },
          { name: 'Share', description: 'Public read-only sharing of issues and views' },
          { name: 'Actions', description: 'Project automation actions' },
          { name: 'Workflows', description: 'Project-bound Mastra workflows and runs' },
          {
            name: 'Workflow builder',
            description: 'Workflows members put together in Plan, which Mastra runs',
          },
          { name: 'Webhooks', description: 'Outgoing webhook subscriptions' },
          {
            name: 'Git',
            description:
              'Repository integration: the inbound pull request webhook and its per-project settings',
          },
          {
            name: 'Routines',
            description: 'Tasks created or reopened for an agent on a schedule, run by Mastra',
          },
          { name: 'Dashboards', description: 'Saved analytics dashboards' },
          { name: 'Knowledge', description: 'The knowledge vault: Docs notes, files and search' },
          {
            name: 'Files',
            description: 'Project-scoped files backed by the restricted workspace bridge',
          },
          { name: 'Link previews', description: 'Public web link metadata' },
          { name: 'Note boards', description: 'Freeform canvases of sticky notes' },
          { name: 'Notifications', description: "The session user's inbox notifications" },
          {
            name: 'Connections',
            description: 'Native runtime connections and human-confirmed mail management',
          },
          {
            name: 'Device sync',
            description: "Syncthing, which syncs the vault with the owner's devices",
          },
          {
            name: 'Owner terminal',
            description: 'Step-up, the 12h terminal grant it opens, and its audit trail',
          },
          { name: 'Project templates', description: 'Reusable project and board structures' },
          {
            name: 'Organization',
            description: 'Team departments, goals, and agent reporting lines',
          },
          { name: 'Hub Inbox', description: 'External message triage and task routing' },
          {
            name: 'Mail',
            description: 'IMAP/SMTP mail accounts, threads, drafts and the mail tools of agents',
          },
          {
            name: 'Agent Activity',
            description: 'The timeline of agent chats, agent runs and workflow runs',
          },
          {
            name: 'Approvals',
            description: 'Agent requests to act outside Plan and the decisions on them',
          },
          { name: 'Sync', description: 'Change markers a client polls for live refresh' },
          {
            name: 'Telegram',
            description: "The session user's linked Telegram account",
          },
          {
            name: 'Analytics',
            description: 'Project metrics: stats, pulse, throughput, breakdowns, activity',
          },
          { name: 'Charts', description: 'Chart specs an agent builds to show in a chat' },
          {
            name: 'Webhook test',
            description: 'Test receiver for inspecting webhook deliveries (dev aid)',
          },
          {
            name: 'God',
            description:
              'Instance administration: registration policy, email provider, sign-in providers, ' +
              'SCIM provisioning',
          },
          {
            name: 'SCIM',
            description: 'SCIM 2.0 provisioning, authenticated with the instance SCIM bearer token',
          },
          {
            name: 'System',
            description: 'Liveness, the current session user, and the instance sign-in policy',
          },
        ],
        // Planner routes are session-gated. Besides the session cookie (sent by the
        // browser, not modelled here), a request may carry an `x-api-key` header:
        // better-auth's apiKey plugin resolves it to the owner's session
        // (enableSessionForAPIKeys). Declaring it here lets the Scalar UI at /docs
        // authorize with a key and call the planner routes.
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
            scimBearer: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'opaque',
              description: 'Instance SCIM token generated in God mode.',
            },
            gitHubSignature: {
              type: 'apiKey',
              in: 'header',
              name: 'x-hub-signature-256',
              description: 'GitHub HMAC signature generated from the raw request body.',
            },
            gitLabToken: {
              type: 'apiKey',
              in: 'header',
              name: 'x-gitlab-token',
              description: 'GitLab secret token configured on the project webhook.',
            },
            giteaSignature: {
              type: 'apiKey',
              in: 'header',
              name: 'x-gitea-signature',
              description: 'Gitea HMAC signature generated from the raw request body.',
            },
            forgejoSignature: {
              type: 'apiKey',
              in: 'header',
              name: 'x-forgejo-signature',
              description: 'Forgejo HMAC signature generated from the raw request body.',
            },
            bitbucketSignature: {
              type: 'apiKey',
              in: 'header',
              name: 'x-hub-signature',
              description: 'Bitbucket HMAC signature generated from the raw request body.',
            },
          },
        },
        security: [{ apiKey: [] }],
      },
    }),
  )
  // OAuth discovery lives at the API origin because MCP clients resolve the
  // authorization server from protected-resource metadata before entering the
  // Better Auth base path.
  .get('/.well-known/oauth-authorization-server', ({ request }) =>
    oAuthDiscoveryMetadata(auth)(request),
  )
  .get('/.well-known/oauth-protected-resource/mcp', ({ request }) =>
    oAuthProtectedResourceMetadata(auth)(request),
  )
  // better-auth: forward every /api/auth/* request to its handler. The OIDC
  // callback gets one extra step afterwards: folding the provider's `groups` claim
  // into the SCIM group tables, so a group mapped to a project in god mode grants
  // access on an OIDC-only instance too, not just one that also runs a SCIM sync.
  .all('/api/auth/*', async ({ request }) => {
    const prefix = new URL(apiUrl).pathname.replace(/\/+$/, '');
    const authUrl = new URL(request.url);
    authUrl.pathname = `${prefix}${authUrl.pathname}`;
    const authRequest = prefix ? new Request(authUrl.toString(), request) : request;
    const response = await auth.handler(authRequest);
    if (new URL(request.url).pathname.startsWith('/api/auth/oauth2/callback/')) {
      await syncOidcGroupsAfterCallback(response);
    }
    return response;
  })
  // Example protected handler: read the session from better-auth.
  .get(
    '/me',
    async ({ request }) => {
      const session = await getSessionFromHeaders(request.headers);
      // A deactivated account is not signed in as far as the app is concerned:
      // every planner route answers 401 for it, and this is what the screens ask
      // first. Deactivation arrives over SCIM, after the session was opened.
      if (!session || session.user.active === false) return { authenticated: false };
      return { authenticated: true, user: session.user };
    },
    {
      detail: {
        tags: ['System'],
        summary: 'Get the current session user',
        description:
          'Resolve the request credentials to a session and return the user it belongs to. ' +
          'Without a session, or for a deactivated account, it answers ' +
          '`{ authenticated: false }` instead of failing.',
      },
    },
  )
  // Reverse-proxy authentication endpoint. It returns no user data: Nginx only
  // needs the status code before it exposes local tools such as Hermes, VS Code,
  // the terminal, and the persistent browser under the Plan origin.
  .get('/auth/verify', async ({ request, status }) => {
    const session = await getSessionFromHeaders(request.headers);
    if (!session || session.user.active === false) return status(401);
    return status(204);
  })
  // The same check for Mastra Studio, which shows the runs of every project and is open
  // to the instance owner only.
  .get(
    '/auth/verify/owner',
    async ({ request, status }) => {
      const session = await getSessionFromHeaders(request.headers);
      if (!session || session.user.active === false) return status(401);
      return status(session.user.role === 'god' ? 204 : 403);
    },
    {
      detail: {
        tags: ['System'],
        summary: 'Check that the session is the instance owner',
        description:
          'Answer 204 for an active session of the instance owner, 403 for another ' +
          'session and 401 without one. Nginx asks it before it forwards a request to ' +
          'Mastra Studio.',
      },
    },
  )
  // The owner-terminal proxy's auth_request target (see
  // deployment/volition-stack/native/owner-terminal/nginx-owner-terminal.conf).
  // Session, owner role and a live 12h grant are all checked here, on every request
  // nginx forwards -- a 204 carries a freshly minted, 60-second signed token in
  // X-Owner-Terminal-Token, which nginx's auth_request_set/proxy_set_header relay to
  // the owner-terminal service. That service verifies the token itself (see its
  // header comment): a nginx location pointed at the wrong kind, or missing this
  // auth_request entirely, opens nothing.
  .get(
    '/auth/verify/owner-terminal/:kind',
    async ({ request, params, set, status }) => {
      // An x-api-key resolves to its owner's session like any other (see
      // apps/api AGENTS.md), which would otherwise let a leaked personal API key
      // open a root shell. The owner terminal is reached only by the owner's own
      // signed-in browser, never by a key -- the same rule
      // modules/connections/interactive.ts's requireInteractiveOwner enforces for
      // the rest of this feature's routes.
      if (request.headers.has('x-api-key') || request.headers.has('authorization')) {
        return status(403);
      }
      const session = await getSessionFromHeaders(request.headers);
      if (!session || session.user.active === false) return status(401);
      if (session.user.role !== 'god') return status(403);
      try {
        set.headers['X-Owner-Terminal-Token'] = await issueProxyToken(
          request,
          params.kind as OwnerTerminalKind,
        );
        return status(204);
      } catch {
        return status(403);
      }
    },
    {
      params: OwnerTerminalKindParam,
      detail: {
        tags: ['Owner terminal'],
        summary: 'Check the terminal grant and mint the owner-terminal proxy token',
        description:
          '204 with X-Owner-Terminal-Token for the owner with a live grant, 403 for ' +
          'anyone else or an expired/revoked grant, 401 without a session.',
      },
    },
  )
  // What the sign-in and sign-up screens need before there is a session: whether
  // registration is open, invite-only, or closed, and which sign-in methods are
  // offered. Public on purpose — the screens are reached logged out. It carries no
  // credentials, only the instance's own policy.
  .get(
    '/auth-config',
    async () => {
      const settings = await getAuthSettings();
      const emailEnabled = await hasConfiguredEmailProvider();
      return {
        registration: settings.registration,
        // Only usable when the instance can actually send mail.
        magicLink: settings.magicLink && emailEnabled,
        // Cleared together with the mail provider, so the raw setting is what the
        // sign-up endpoint enforces.
        requireEmailVerification: settings.requireEmailVerification,
        emailEnabled,
        // Whether the email/password form is offered at all. The api refuses to turn
        // it off while no provider below is usable, so this is never false alone.
        emailPassword: settings.emailPassword,
        google: await hasConfiguredGoogle(),
        oidc: await hasConfiguredOidc(),
        // Names the operator's own identity provider, so the button shows it as
        // given. Empty falls back to a translated default.
        oidcLabel: await getOidcLabel(),
      };
    },
    {
      detail: {
        tags: ['System'],
        summary: "Get the instance's sign-in configuration",
        description:
          'Report the registration policy and the sign-in methods the instance offers, so the ' +
          'sign-in and sign-up screens can render before there is a session. Public.',
      },
    },
  )
  // Root doubles as the liveness/health endpoint.
  .get('/', () => ({ name: 'Helena api', status: 'ok' }), {
    detail: {
      tags: ['System'],
      summary: 'Check that the api is up',
      description: 'Liveness probe: returns the api name and `status: "ok"`.',
    },
  })
  // Inbound repository webhook receiver (authenticated by its per-project secret).
  .use(gitWebhookRoutes)
  // SCIM 2.0 provisioning (authenticated by the instance SCIM bearer token). Mounted
  // here rather than under the planner: the planner's session guard would answer 401
  // before the bearer check runs, and its error handler emits a body SCIM does not
  // understand.
  .use(scimRoutes)
  // Planner API: projects, issues, and their dependent entities.
  .use(planner);

// MCP endpoint (POST /mcp). Added after the chain so `type App` (the Eden client
// type) stays the REST surface; the MCP endpoint is JSON-RPC, not called via Eden.
// Its tools are generated from the planner routes tagged with mcpTool().
mountMcp(app);

// Hands the assembled app to the internal agent runtime, which builds an agent's
// tools from the same mcpTool() routes and dispatches them in process. It cannot
// import this module without a cycle, so the reference is passed here.
setMcpApp(app);

// App type — useful for Eden Treaty (type-safe client) on the frontend and in tests.
export type App = typeof app;
