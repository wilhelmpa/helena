import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Native hardening limits this key to the API and owner-terminal systemd units.
// CLI processes receive scoped terminal capabilities, never this key.
const keyPath = () => process.env.OWNER_TERMINAL_KEY_PATH ?? '/etc/volition/owner-terminal.key';

// Matches the router: a 60-second window is long enough for one request/reconnect
// round trip and short enough that a captured token is worthless a minute later.
const TOKEN_TTL_SEC = 60;

let cachedKey: string | null = null;
function key(): string {
  if (cachedKey === null) cachedKey = readFileSync(keyPath(), 'utf8').trim();
  return cachedKey;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// The wire format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256 of that
// exact string). deployment/volition-stack/native/owner-terminal/owner-terminal-router.mjs
// decodes and verifies this independently -- it is the one other place that has to
// agree on the shape, and does not import this file (the router has no build step
// and no dependency on this app; see its own header comment for why).
export interface OwnerTerminalTokenPayload {
  sessionId: string;
  kind: string;
  exp: number;
  purpose: 'owner-terminal';
  access?: OwnerTerminalAccess;
}

// Minted by GET /auth/verify/owner-terminal/:kind (apps/api/src/app.ts), which nginx
// calls via auth_request before it proxies a request to the owner-terminal socket.
// Session validity, the owner role and the 12h grant are all checked before this is
// called -- the token only has to prove to the completely separate owner-terminal
// process that Plan already did that check, for the specific kind being requested.
export interface OwnerTerminalAccess {
  grantId: number | null;
  grantCreatedAt: string | null;
  grantExpiresAt: string | null;
  lanIp: string | null;
  expiresAt: number;
}

export function signTerminalPayload(payload: object): string {
  const body = base64url(JSON.stringify(payload));
  const mac = base64url(createHmac('sha256', key()).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyTerminalPayload(token: string): Record<string, unknown> | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, mac] = parts as [string, string];
    const expected = createHmac('sha256', key()).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function mintOwnerTerminalToken(
  sessionId: string,
  kind: string,
  access?: OwnerTerminalAccess,
): string {
  const payload: OwnerTerminalTokenPayload = {
    sessionId,
    kind,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
    purpose: 'owner-terminal',
    ...(access ? { access } : {}),
  };
  return signTerminalPayload(payload);
}
