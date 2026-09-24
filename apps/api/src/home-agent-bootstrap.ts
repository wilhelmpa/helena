import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { Elysia } from 'elysia';

import {
  bootstrapHomeAgent,
  bootstrapProjectAgent,
  bootstrapProjectCoordinator,
} from './scripts/bootstrap-home-agent';

// A secret must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there.
function secretModeMask(file: string): number {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

let tokenPromise: Promise<string> | null = null;

// The path is read on first use rather than at import, so a test can point it at a
// token file of its own.
async function bootstrapToken(): Promise<string> {
  const tokenFile =
    process.env.PLAN_CONTROL_TOKEN_FILE?.trim() || '/run/secrets/plan_control_token';
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

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

function validKey(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= 2048);
}

function privateJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
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
  .post(
    '/internal/bootstrap/home-agent',
    async ({ request }) => {
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
    },
    {
      detail: {
        summary: 'Create the Home agent (host only)',
        description:
          'First-run bridge of the factory host, with its control token: creates the Home ' +
          'agent and answers its key, or 425 while the installation has no owner yet.',
      },
    },
  )
  .post(
    '/internal/bootstrap/project-coordinator',
    async ({ request, body }) => {
      const denied = await authorizeControlRequest(request);
      if (denied) return denied;
      const input = body as { projectId?: unknown; apiKey?: unknown } | null;
      const projectId = positiveId(input?.projectId);
      if (!projectId) return new Response('Invalid project', { status: 400 });
      const apiKey = input?.apiKey;
      if (!validKey(apiKey)) return new Response('Invalid key', { status: 400 });
      const result = await bootstrapProjectCoordinator(projectId, apiKey);
      if (!result) return new Response('Project not found', { status: 404 });
      return privateJson(result);
    },
    {
      detail: {
        summary: "Set up a project's coordinator (host only)",
        description:
          "Host-only, with the control token: gives the project's coordinator the key the " +
          'host created for its runner.',
      },
    },
  )
  .post(
    '/internal/bootstrap/project-agent',
    async ({ request, body }) => {
      const denied = await authorizeControlRequest(request);
      if (denied) return denied;
      const input = body as { projectId?: unknown; agentId?: unknown; apiKey?: unknown } | null;
      const projectId = positiveId(input?.projectId);
      const agentId = positiveId(input?.agentId);
      if (!projectId || !agentId) return new Response('Invalid project or agent', { status: 400 });
      const apiKey = input?.apiKey;
      if (!validKey(apiKey)) return new Response('Invalid key', { status: 400 });
      const result = await bootstrapProjectAgent(projectId, agentId, apiKey);
      if (!result) return new Response('Agent not found in this project', { status: 404 });
      return privateJson(result);
    },
    {
      detail: {
        summary: "Set up a project agent's runner (host only)",
        description:
          'Host-only, with the control token: gives an agent of the project the key the host ' +
          'created for its runner.',
      },
    },
  );
