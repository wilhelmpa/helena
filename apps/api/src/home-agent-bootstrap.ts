import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { Elysia } from 'elysia';

import { bootstrapHomeAgent, bootstrapProjectCoordinator } from './scripts/bootstrap-home-agent';

const TOKEN_FILE =
  process.env.MASTRA_CONTROL_TOKEN_FILE?.trim() || '/run/secrets/mastra_control_token';
let tokenPromise: Promise<string> | null = null;

async function bootstrapToken(): Promise<string> {
  tokenPromise ??= lstat(TOKEN_FILE)
    .then(async (stat) => {
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw new Error('invalid secret file');
      }
      const token = (await readFile(TOKEN_FILE, 'utf8')).trim();
      if (Buffer.byteLength(token) < 32 || token.length > 2048) {
        throw new Error('invalid token');
      }
      return token;
    })
    .catch((error) => {
      tokenPromise = null;
      throw error;
    });
  return tokenPromise;
}

function sameSecret(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function authorizeControlRequest(request: Request): Promise<Response | null> {
  const authorization = request.headers.get('authorization') ?? '';
  const given = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  let expected: string;
  try {
    expected = await bootstrapToken();
  } catch {
    return new Response('Bootstrap unavailable', { status: 503 });
  }
  return sameSecret(given, expected) ? null : new Response('Unauthorized', { status: 401 });
}

// Host-only first-run bridge. The random control token is mounted read-only into the
// API and never appears in logs. Cloudflare can reach the path, but cannot call it
// without that token; only the local factory host holds it.
export const homeAgentBootstrapRoutes = new Elysia({ name: 'home-agent-bootstrap' })
  .post('/internal/bootstrap/home-agent', async ({ request }) => {
    const denied = await authorizeControlRequest(request);
    if (denied) return denied;

    const result = await bootstrapHomeAgent();
    if (result.status === 'pending') return new Response(null, { status: 425 });
    return new Response(result.apiKey, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  })
  .post('/internal/bootstrap/project-coordinator', async ({ request, body }) => {
    const denied = await authorizeControlRequest(request);
    if (denied) return denied;
    const projectId = Number((body as { projectId?: unknown } | null)?.projectId);
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      return new Response('Invalid project', { status: 400 });
    }
    const result = await bootstrapProjectCoordinator(projectId);
    if (!result) return new Response('Project not found', { status: 404 });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  });
