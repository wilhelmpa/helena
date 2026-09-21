import { timingSafeEqual } from 'node:crypto';
import { intEnv } from './env';
import { hubInboxConfig, type HubInboxConfig } from './hub-inbox-client';
import { wakeHubInboxSync } from './hub-inbox-worker';
import type { WorkerHandle } from './poll-loop';

const MAX_BODY_BYTES = 4 * 1024;

export function startHubInboxWakeServer(): WorkerHandle {
  const config = hubInboxConfig();
  if (!config) return { stop() {} };
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: intEnv('INBOX_WAKE_PORT', 18801),
    fetch: (request) => handleHubInboxWake(request, config),
  });
  console.log(`[hub-inbox] private wake listener started on port ${server.port}`);
  return { stop: () => server.stop(true) };
}

export async function handleHubInboxWake(
  request: Request,
  config: HubInboxConfig,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/internal/inbox/wake') {
    return new Response(null, { status: 404 });
  }
  if (!authorized(request.headers.get('authorization'), config.token)) {
    return new Response(null, { status: 401 });
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return new Response(null, { status: 400 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new Response(null, { status: 400 });
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(body).sort().join(',');
    if (
      keys !== 'account,channel,schemaVersion' ||
      body.schemaVersion !== 1 ||
      body.channel !== 'mail' ||
      typeof body.account !== 'string' ||
      body.account.length === 0 ||
      body.account.length > 320 ||
      (config.accounts.length > 0 && !config.accounts.includes(body.account))
    ) {
      return new Response(null, { status: 400 });
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  wakeHubInboxSync();
  return new Response(null, { status: 204 });
}

function authorized(header: string | null, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
