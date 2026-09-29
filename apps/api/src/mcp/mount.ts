import { t } from 'elysia';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { auth, getSessionFromHeaders, RateLimitedError, withMcpAuth } from '@repo/auth';
import { tooManyRequests } from '../shared/rate-limit';
import { buildMcpServer } from './server';
import type { McpApp } from './types';
import type { McpCredential } from './credential';
import { agentSocketProject, checkAgentSocket } from '../shared/agent-socket';
import { HttpError } from '../shared/lib';

function refused(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 403;
  const message = error instanceof HttpError ? error.message : 'Forbidden';
  return Response.json({ error: message }, { status });
}

// The API key on the request. MCP clients send Authorization: Bearer <key>;
// x-api-key is also accepted (the REST convention). Returns null when absent.
function extractApiKey(request: Request): string | null {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const direct = request.headers.get('x-api-key');
  return direct ?? (bearer?.startsWith('itp_') ? bearer : null);
}

function withoutCredentials(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('x-api-key');
  return new Request(request.url, { method: request.method, headers });
}

// Adds the MCP endpoint (POST /mcp) to the app and returns the same app. Mounted on
// the root app, outside the planner session guard, because the MCP handshake is not
// a planner route: auth is resolved here and the key is forwarded to the loopback
// requests the tools make. `app` is captured so the tool generator can read
// app.routes and each tool call can dispatch through app.handle.
//
// Stateless transport (sessionIdGenerator undefined): a fresh server and transport
// per request. Personal API keys remain supported for existing integrations; native
// OAuth is the default route for clients that discover this resource, such as ChatGPT.
// Typed as `any` because it is the composition root: it needs Elysia's `.post` to
// register the route, and Elysia's generics are invariant, so a precise parameter
// type would reject the concrete app. The captured `app` is passed on as McpApp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountMcp(app: any): void {
  const mcpApp = app as McpApp;
  // Streamable HTTP lets a client GET the endpoint for a server-to-client stream and
  // DELETE it to end a session. This server is stateless (a fresh server per POST), so
  // it offers neither and answers 405 with Allow: POST, as the transport spec asks,
  // in the JSON-RPC error shape the SDK's transport uses for the same answer.
  const methodNotAllowed = () =>
    Response.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
      { status: 405, headers: { Allow: 'POST' } },
    );
  for (const method of ['get', 'delete'] as const) {
    app[method]('/mcp', methodNotAllowed, { detail: { hide: true } });
  }
  app.post(
    '/mcp',
    async ({ request, body }: { request: Request; body: unknown }) => {
      // The run an agent's runtime names on its requests (x-helena-run), for the policy
      // engine's log and the run's Autopilot report.
      const runHeader = Number(request.headers.get('x-helena-run'));
      const runId = Number.isInteger(runHeader) && runHeader > 0 ? runHeader : null;
      const serve = async (credential: McpCredential, userId: string) => {
        const server = await buildMcpServer(mcpApp, credential, userId, {
          runId,
          agentUnit: request.headers.get('x-volition-agent-unit'),
          agentRuntime: request.headers.get('x-volition-agent-runtime'),
          messageId: Number(request.headers.get('x-volition-message')) || null,
          agentProject: agentSocketProject(request.headers),
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        // Pass the body Elysia already parsed so the request stream is not read twice.
        return transport.handleRequest(request, { parsedBody: body });
      };

      const apiKey = extractApiKey(request);
      // An isolated agent reaches this endpoint only through the agent socket, which
      // names its project; there it has to use the key of an agent of that project.
      let agentSocket: string | null;
      try {
        agentSocket = agentSocketProject(request.headers);
      } catch (error) {
        return refused(error);
      }
      if (agentSocket !== null && !apiKey) {
        return refused(new HttpError(403, 'Only an agent key is accepted on the agent socket'));
      }
      if (apiKey) {
        const headers = new Headers(request.headers);
        headers.set('x-api-key', apiKey);
        let session;
        try {
          session = await getSessionFromHeaders(headers);
        } catch (error) {
          if (error instanceof RateLimitedError) return tooManyRequests(error);
          throw error;
        }
        // A deactivated account is refused here too, the way shared/auth-context.ts
        // refuses it for every planner route. Deactivation arrives over SCIM, after
        // the key was issued.
        if (session && session.user.active !== false) {
          try {
            await checkAgentSocket(request.headers, session.user.id);
          } catch (error) {
            return refused(error);
          }
          return serve({ kind: 'api-key', apiKey }, session.user.id);
        }
        // Do not reinterpret a revoked or malformed personal API key as an OAuth
        // token. Challenge without forwarding the rejected credential so auth
        // failures stay 401 and the credential never reaches an error/log path.
        return withMcpAuth(auth, () => Promise.reject(new Error('unreachable')))(
          withoutCredentials(request),
        );
      }
      // withMcpAuth verifies the native OAuth token and returns the standard MCP
      // WWW-Authenticate challenge that clients use for OAuth discovery.
      return withMcpAuth(auth, (_request, oauthSession) =>
        serve({ kind: 'oauth', accessToken: oauthSession.accessToken }, oauthSession.userId),
      )(request);
    },
    {
      body: t.Any(),
      // Kept out of the REST OpenAPI docs: this is a JSON-RPC endpoint, not a REST route.
      detail: { summary: 'MCP Streamable HTTP endpoint', hide: true },
    },
  );
}
