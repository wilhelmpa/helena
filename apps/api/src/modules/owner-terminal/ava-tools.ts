import { Elysia, t } from 'elysia';
import { aiAgent, db, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { authorizeLocalTerminal } from './service';
import { signTerminalPayload, verifyTerminalPayload, type OwnerTerminalAccess } from './token';
import { rootOwner } from '#modules/root-access/service';

const kinds = [
  'claude',
  'codex',
  'helena-dev-claude',
  'helena-dev-codex',
  'local-qwen36',
  'local-qwen38',
  'local-flash',
];
export const OWNER_TOOLS_HEADER = 'x-volition-owner-tools';
const runtimes = new WeakMap<Request, string>();
export const ownerToolsRuntime = (request: Request) => runtimes.get(request);

export function nativeOwnerRequest(request: Request) {
  if (
    [
      'cookie',
      'origin',
      'x-api-key',
      'authorization',
      'sec-fetch-site',
      'x-real-ip',
      'x-forwarded-for',
      'forwarded',
      'x-volition-agent-project',
      'x-volition-agent-unit',
    ].some((header) => request.headers.has(header))
  )
    throw new HttpError(403, 'Owner tools require the native terminal capability');
}

async function authorized(token: string, purpose: string) {
  const value = verifyTerminalPayload(token);
  if (
    !value ||
    value.purpose !== purpose ||
    typeof value.kind !== 'string' ||
    !kinds.includes(value.kind) ||
    typeof value.sessionId !== 'string' ||
    !value.access
  )
    throw new HttpError(403, 'Invalid owner tools capability');
  const access = value.access as OwnerTerminalAccess;
  if (!Number.isInteger(access.expiresAt) || access.expiresAt > Date.now() / 1000 + 12 * 3600)
    throw new HttpError(403, 'Invalid owner tools expiry');
  const ownerId = await authorizeLocalTerminal(value.sessionId, access);
  return { value, ownerId };
}

export async function ownerToolsUser(request: Request) {
  nativeOwnerRequest(request);
  const { value, ownerId } = await authorized(
    request.headers.get(OWNER_TOOLS_HEADER) ?? '',
    'volition-owner-tools',
  );
  const [home] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .where(eq(aiAgent.agentRole, 'home'))
    .limit(1);
  if (!home || (await rootOwner(home.id)) !== ownerId)
    throw new HttpError(403, 'Owner Home agent unavailable');
  const caller = await db.query.user.findFirst({ where: eq(user.id, home.userId) });
  if (!caller || !caller.active) throw new HttpError(403, 'Home agent unavailable');
  runtimes.set(
    request,
    String(value.kind).includes('claude')
      ? 'claude'
      : String(value.kind).startsWith('local-')
        ? 'helena'
        : 'codex',
  );
  return caller;
}

export const ownerAvaToolsRoutes = new Elysia({ name: 'volition-owner-tools' })
  .onError(({ error, set }) => {
    set.status = error instanceof HttpError ? error.status : 500;
    set.headers['cache-control'] = 'no-store';
    return { error: error instanceof HttpError ? error.message : 'Owner tools unavailable' };
  })
  .post(
    '/owner-terminal/ava/:kind/bootstrap',
    async ({ request, params }) => {
      nativeOwnerRequest(request);
      const { value } = await authorized(
        request.headers.get('x-owner-terminal-token') ?? '',
        'owner-terminal',
      );
      if (value.kind !== params.kind) throw new HttpError(403, 'Terminal kind differs');
      return {
        token: signTerminalPayload({
          ...value,
          purpose: 'volition-owner-tools',
          exp: (value.access as OwnerTerminalAccess).expiresAt,
        }),
        expiresAt: (value.access as OwnerTerminalAccess).expiresAt,
      };
    },
    {
      parse: 'none',
      params: t.Object({ kind: t.Union(kinds.map((kind) => t.Literal(kind))) }),
      detail: { hide: true, summary: 'Bind Ava tools to an authorized owner terminal' },
    },
  );
