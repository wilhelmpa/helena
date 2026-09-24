import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { auth, getSessionFromHeaders } from '@repo/auth';
import { db, getSetting, setSetting, ownerTerminalGrant, ownerTerminalAudit } from '@repo/db';
import { HttpError } from '#shared/lib';
import { isLanAddress } from './lan';
import { mintOwnerTerminalToken } from './token';
import type { OwnerTerminalKind } from './model';

const GRANT_HOURS = 12;
const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const AUDIT_LIST_LIMIT = 200;

const iso = (value: Date): string => value.toISOString();

// ── Instance-wide policy (Home -> Security) ─────────────────────────────────────

const SETTINGS_KEY = 'ownerTerminal';

export interface OwnerTerminalSettings {
  // Forward-looking: only 'totp' is ever produced today (see model.ts). Kept as a
  // list so a future passkey rollout, once HTTPS is up, is a setting change and
  // not a schema change.
  stepUpMethods: ('totp' | 'passkey')[];
  // Whether the sudoers policy the browser terminal runs under asks for the Linux
  // password. Read by deployment/volition-stack/native/owner-terminal/setup.sh,
  // and only when the orchestrator passes --install-sudo-policy explicitly --
  // sudo authorizes purely by Unix user, so nothing at runtime can make sudo
  // itself treat a browser-terminal shell differently from an SSH one for the
  // same account, and turning this on is only safe once the orchestrator's
  // `sudo -n` automation has been fully audited against the sudoers Cmnd_Aliases
  // (see 90-wilhelmpa's own comment). Defaults to false -- the existing blanket
  // NOPASSWD stays in effect, and the UI says why turning this on needs that
  // audit first, rather than presenting a security setting that quietly does
  // less than it says until someone performs a separate, undocumented step.
  sudoPasswordRequired: boolean;
  // false: an owner session coming from the LAN opens the terminal without a
  // TOTP code (owner, 2026-09-24, while the instance is still being built).
  // Loopback -- where the Cloudflare tunnel will arrive -- and any other public
  // address always need the code, whatever this says; see lanBypass below.
  stepUpRequired: boolean;
  recordOutput: Partial<Record<OwnerTerminalKind, boolean>>;
}

function defaultSettings(): OwnerTerminalSettings {
  return {
    stepUpMethods: ['totp'],
    sudoPasswordRequired: false,
    stepUpRequired: true,
    recordOutput: {},
  };
}

export async function getOwnerTerminalSettings(): Promise<OwnerTerminalSettings> {
  const stored = await getSetting<Partial<OwnerTerminalSettings>>(SETTINGS_KEY);
  return { ...defaultSettings(), ...(stored ?? {}) };
}

export async function setOwnerTerminalSettings(
  patch: Partial<OwnerTerminalSettings>,
): Promise<OwnerTerminalSettings> {
  const next: OwnerTerminalSettings = {
    ...(await getOwnerTerminalSettings()),
    ...patch,
    stepUpMethods: ['totp'],
  };
  await setSetting(SETTINGS_KEY, next);
  return next;
}

// ── Request context ──────────────────────────────────────────────────────────

interface RequestSession {
  userId: string;
  sessionId: string;
}

// requireInteractiveOwner already proved the request carries a valid, cookie-based
// owner session before any handler in this module runs; this reads the session id
// out of it, which authContext's `user` does not carry.
async function requireSession(request: Request): Promise<RequestSession> {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return { userId: session.user.id, sessionId: session.session.id };
}

// The LAN rule itself (IPv4 private ranges, IPv6 on the home network) is in ./lan.
export { isLanAddress };

// True when this request may use the terminal without a grant: the owner turned
// the step-up off (Administrator -> Sicherheit) and the request comes from the LAN.
async function lanBypass(request: Request): Promise<boolean> {
  const settings = await getOwnerTerminalSettings();
  return !settings.stepUpRequired && isLanAddress(clientIp(request));
}

function deviceLabel(request: Request): string {
  return (request.headers.get('user-agent') ?? 'unknown device').slice(0, 200);
}

// Sits behind nginx in every deployment (see deployment/volition-stack/native/nginx),
// which is what sets this header from the real client address.
function clientIp(request: Request): string {
  return (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown')
    .split(',')[0]!
    .trim();
}

async function writeAudit(entry: {
  userId: string | null;
  event: string;
  kind?: string | null;
  sessionName?: string | null;
  device?: string | null;
  ipAddress?: string | null;
  detail?: string | null;
}): Promise<void> {
  await db.insert(ownerTerminalAudit).values({
    userId: entry.userId,
    event: entry.event,
    kind: entry.kind ?? null,
    sessionName: entry.sessionName ?? null,
    device: entry.device ?? null,
    ipAddress: entry.ipAddress ?? null,
    detail: entry.detail ?? null,
  });
}

async function recentFailureCount(userId: string): Promise<number> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000);
  const rows = await db
    .select({ id: ownerTerminalAudit.id })
    .from(ownerTerminalAudit)
    .where(
      and(
        eq(ownerTerminalAudit.userId, userId),
        sql`${ownerTerminalAudit.event} IN ('step_up_fail', 'rate_limited')`,
        gt(ownerTerminalAudit.createdAt, since),
      ),
    );
  return rows.length;
}

// ── Step-up and grants ───────────────────────────────────────────────────────

export interface OwnerTerminalGrantDto {
  active: boolean;
  method: 'totp' | 'passkey' | null;
  expiresAt: string | null;
  device: string | null;
  ipAddress: string | null;
}

async function currentGrantRow(userId: string, sessionId: string) {
  const rows = await db
    .select()
    .from(ownerTerminalGrant)
    .where(
      and(
        eq(ownerTerminalGrant.userId, userId),
        eq(ownerTerminalGrant.sessionId, sessionId),
        isNull(ownerTerminalGrant.revokedAt),
        gt(ownerTerminalGrant.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(ownerTerminalGrant.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// Verifies a live TOTP code against the owner's *already signed-in* session,
// through better-auth's own two-factor plugin (auth.api.verifyTOTP) rather than a
// hand-rolled TOTP check -- see packages/auth/src/index.ts for why that call, made
// with the request's normal session cookie, is a step-up check here and not a
// sign-in: better-auth's verifyTwoFactor() resolves an existing session first and
// only falls back to its sign-in cookie when there is none (verify-two-factor.mjs
// in the installed package). A first successful call here also flips
// `twoFactor.verified` to true, which is what turns "TOTP enrolled" into
// "TOTP usable" -- so this same endpoint finishes the enrollment the owner starts
// at Account -> Security.
export async function stepUpWithTotp(
  request: Request,
  code: string,
): Promise<{ expiresAt: string }> {
  const { userId, sessionId } = await requireSession(request);
  const device = deviceLabel(request);
  const ipAddress = clientIp(request);

  if ((await recentFailureCount(userId)) >= RATE_LIMIT_MAX_ATTEMPTS) {
    await writeAudit({ userId, event: 'rate_limited', device, ipAddress });
    throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  }

  try {
    await auth.api.verifyTOTP({ headers: request.headers, body: { code } });
  } catch {
    await writeAudit({ userId, event: 'step_up_fail', device, ipAddress });
    // 400, not 401: the web client treats any 401 as "session gone" and signs the
    // owner out, which is what a mistyped code did until 2026-09-24.
    throw new HttpError(400, 'The code was not accepted');
  }

  const expiresAt = new Date(Date.now() + GRANT_HOURS * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    // One active grant per owner: a new step-up replaces rather than stacks.
    await tx
      .update(ownerTerminalGrant)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(ownerTerminalGrant.userId, userId), isNull(ownerTerminalGrant.revokedAt)));
    await tx.insert(ownerTerminalGrant).values({
      userId,
      sessionId,
      method: 'totp',
      device,
      ipAddress,
      expiresAt,
    });
  });
  await writeAudit({ userId, event: 'step_up_ok', device, ipAddress });
  return { expiresAt: iso(expiresAt) };
}

export async function grantStatus(request: Request): Promise<OwnerTerminalGrantDto> {
  const { userId, sessionId } = await requireSession(request);
  const row = await currentGrantRow(userId, sessionId);
  if (!row && (await lanBypass(request))) {
    return {
      active: true,
      method: null,
      expiresAt: null,
      device: deviceLabel(request),
      ipAddress: clientIp(request),
    };
  }
  if (!row) return { active: false, method: null, expiresAt: null, device: null, ipAddress: null };
  return {
    active: true,
    method: row.method as 'totp' | 'passkey',
    expiresAt: iso(row.expiresAt),
    device: row.device,
    ipAddress: row.ipAddress,
  };
}

export async function revokeGrant(request: Request): Promise<void> {
  const { userId, sessionId } = await requireSession(request);
  await db
    .update(ownerTerminalGrant)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(ownerTerminalGrant.userId, userId),
        eq(ownerTerminalGrant.sessionId, sessionId),
        isNull(ownerTerminalGrant.revokedAt),
      ),
    );
  await writeAudit({
    userId,
    event: 'grant_revoked',
    device: deviceLabel(request),
    ipAddress: clientIp(request),
  });
}

// ── Audit list (Home -> Security) ────────────────────────────────────────────

export interface OwnerTerminalAuditDto {
  id: number;
  event: string;
  kind: string | null;
  sessionName: string | null;
  device: string | null;
  ipAddress: string | null;
  detail: string | null;
  createdAt: string;
}

export async function listAudit(): Promise<OwnerTerminalAuditDto[]> {
  const rows = await db
    .select()
    .from(ownerTerminalAudit)
    .orderBy(desc(ownerTerminalAudit.createdAt))
    .limit(AUDIT_LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    kind: row.kind,
    sessionName: row.sessionName,
    device: row.device,
    ipAddress: row.ipAddress,
    detail: row.detail,
    createdAt: iso(row.createdAt),
  }));
}

// ── Sessions (the Terminal panel itself) ─────────────────────────────────────

// Recorded by the web panel when a tab actually opens or closes (see
// features/owner-terminal), not inferred from the proxy traffic: the
// owner-terminal-router has no database access by design (see its header
// comment), and nginx's auth_request fires on every asset request a session
// makes, not just the one that starts it, so it cannot stand in for this either.
export async function recordSessionEvent(
  request: Request,
  event: 'session_start' | 'session_end',
  kind: OwnerTerminalKind,
  name: string,
): Promise<void> {
  const { userId, sessionId } = await requireSession(request);
  const grant = await currentGrantRow(userId, sessionId);
  const bypass = !grant && (await lanBypass(request));
  if (!grant && !bypass) throw new HttpError(403, 'No active terminal grant');
  await writeAudit({
    detail: bypass ? 'lan_without_step_up' : null,
    userId,
    event,
    kind,
    sessionName: name,
    device: deviceLabel(request),
    ipAddress: clientIp(request),
  });
}

// Called by GET /auth/verify/owner-terminal/:kind (apps/api/src/app.ts), the
// nginx auth_request target for the owner-terminal proxy. Throws unless the
// request's session holds a live grant, so nginx forwards the token only then.
export async function issueProxyToken(request: Request, kind: OwnerTerminalKind): Promise<string> {
  const { userId, sessionId } = await requireSession(request);
  const grant = await currentGrantRow(userId, sessionId);
  if (!grant && !(await lanBypass(request))) throw new HttpError(403, 'No active terminal grant');
  return mintOwnerTerminalToken(sessionId, kind);
}
