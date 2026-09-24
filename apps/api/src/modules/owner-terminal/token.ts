import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The key file setup.sh generates once (see
// deployment/volition-stack/native/owner-terminal/setup.sh), root:volition,
// mode 0640. This process reads it as User=volition-plan; the owner-terminal
// service reads the same file as User=wilhelmpa -- both are members of the
// `volition` group already (see deployment/.../90-wilhelmpa and the group check
// in the setup script), so no new group is needed for this alone.
// Read when the first token is minted, not at import, so a test can point it at its own key.
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
}

// Minted by GET /auth/verify/owner-terminal/:kind (apps/api/src/app.ts), which nginx
// calls via auth_request before it proxies a request to the owner-terminal socket.
// Session validity, the owner role and the 12h grant are all checked before this is
// called -- the token only has to prove to the completely separate owner-terminal
// process that Plan already did that check, for the specific kind being requested.
export function mintOwnerTerminalToken(sessionId: string, kind: string): string {
  const payload: OwnerTerminalTokenPayload = {
    sessionId,
    kind,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
    purpose: 'owner-terminal',
  };
  const body = base64url(JSON.stringify(payload));
  const mac = base64url(createHmac('sha256', key()).update(body).digest());
  return `${body}.${mac}`;
}
