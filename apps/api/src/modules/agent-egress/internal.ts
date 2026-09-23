import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { Elysia } from 'elysia';
import { egressPolicies, parseEgressEvents, recordEgressEvents } from './service';

// The egress proxy's own routes: it reads the settings of every project and reports what
// it let through. Its token is a file of its own (AGENT_EGRESS_TOKEN_FILE), so the proxy
// holds no other control credential and nothing else can post reports.
let tokenPromise: Promise<string> | null = null;

async function egressToken(): Promise<string> {
  const tokenFile = process.env.AGENT_EGRESS_TOKEN_FILE?.trim();
  if (!tokenFile) throw new Error('no egress token configured');
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
    expected = Buffer.from(await egressToken());
  } catch {
    return new Response('Egress reporting unavailable', { status: 503 });
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

export const agentEgressInternalRoutes = new Elysia({ name: 'agent-egress-internal' })
  .get(
    '/internal/agent-egress/policy',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      return privateJson({ schemaVersion: 1, projects: await egressPolicies() });
    },
    { detail: { hide: true } },
  )
  .post(
    '/internal/agent-egress/events',
    async ({ request }) => {
      const refused = await denied(request);
      if (refused) return refused;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return privateJson({ error: 'Invalid JSON' }, 400);
      }
      const events = parseEgressEvents(body);
      if (!events) return privateJson({ error: 'Invalid report' }, 400);
      return privateJson({ stored: await recordEgressEvents(events) });
    },
    { detail: { hide: true } },
  );
