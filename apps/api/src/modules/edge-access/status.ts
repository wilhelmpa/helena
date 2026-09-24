import { readFile } from 'node:fs/promises';
import { and, count, eq, gt } from 'drizzle-orm';
import { db } from '@repo/db';
import { passkey, session, user } from '@repo/db/schema';
import { getOwnerTerminalSettings } from '#modules/owner-terminal/service';
import { edgeAccessConfigured, getEdgeAccessSettings } from './service';

// The server's security state for Administrator → Sicherheit (and, once hub/server-admin is
// merged, its Server → Sicherheit tab): the result of the host audit
// (deployment/volition-stack/native/hardening/audit.sh, run by root on a timer, which
// writes a JSON file without any secret in it), plus what Helena itself knows: the owner's
// second factors, the terminal step-up, the edge sign-in and the open sessions.

export const AUDIT_STATES = ['pass', 'fail', 'warn', 'skip'] as const;
export type AuditState = (typeof AUDIT_STATES)[number];
export const AUDIT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export interface AuditCheck {
  id: string;
  group: string;
  state: AuditState;
  severity: AuditSeverity;
  detail: string;
}

export interface AuditReport {
  ranAt: string;
  host: string;
  stale: boolean;
  summary: Record<AuditState, number>;
  checks: AuditCheck[];
}

export function auditFile(): string {
  return process.env.HELENA_SECURITY_AUDIT_FILE || '/var/lib/helena/security/audit.json';
}
// The timer runs the audit hourly; a report older than a day says the timer stopped.
const STALE_MS = 26 * 3600_000;
const ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// The file is written by root, but it is parsed defensively all the same: only known
// states and severities and bounded strings reach the page.
export function parseAuditReport(raw: string, now = Date.now()): AuditReport | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const ranAt = text(record.ranAt, 40);
  if (!ranAt || Number.isNaN(Date.parse(ranAt)) || !Array.isArray(record.checks)) return null;
  const checks: AuditCheck[] = [];
  for (const entry of record.checks.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const check = entry as Record<string, unknown>;
    const id = text(check.id, 64);
    const state = check.state as AuditState;
    const severity = check.severity as AuditSeverity;
    if (!ID.test(id) || !AUDIT_STATES.includes(state) || !AUDIT_SEVERITIES.includes(severity)) {
      continue;
    }
    checks.push({ id, group: text(check.group, 32) || 'other', state, severity, detail: text(check.detail, 300) });
  }
  const summary = { pass: 0, fail: 0, warn: 0, skip: 0 } as Record<AuditState, number>;
  for (const check of checks) summary[check.state] += 1;
  return {
    ranAt: new Date(ranAt).toISOString(),
    host: text(record.host, 64),
    stale: now - Date.parse(ranAt) > STALE_MS,
    summary,
    checks,
  };
}

export async function readAuditReport(path = auditFile()): Promise<AuditReport | null> {
  try {
    return parseAuditReport(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export type SecurityHealthState = 'ok' | 'attention' | 'critical' | 'unknown';

// One line for an overview (Start, Server → Übersicht): red when a critical or high check
// fails, amber for any other failure or warning or an old report. Shaped like
// @helena/sdk's HostHealthItem so hub/server-admin can register it as a host capability.
export function securityHealth(report: AuditReport | null): {
  id: string;
  state: SecurityHealthState;
  code: string;
  values: Record<string, number>;
} {
  if (!report) return { id: 'security:audit', state: 'unknown', code: 'security.noReport', values: {} };
  const failing = report.checks.filter((check) => check.state === 'fail');
  const severe = failing.filter((check) => check.severity === 'critical' || check.severity === 'high');
  const state: SecurityHealthState =
    severe.length > 0
      ? 'critical'
      : failing.length > 0 || report.summary.warn > 0 || report.stale
        ? 'attention'
        : 'ok';
  return {
    id: 'security:audit',
    state,
    code: state === 'ok' ? 'security.allPassed' : 'security.findings',
    values: { failed: failing.length, severe: severe.length, warnings: report.summary.warn },
  };
}

export async function securityStatus() {
  const [audit, edge, terminal] = await Promise.all([
    readAuditReport(),
    getEdgeAccessSettings(),
    getOwnerTerminalSettings(),
  ]);
  const [owner] = await db
    .select({ id: user.id, totp: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.role, 'god'))
    .limit(1);
  const ownerId = owner?.id ?? '';
  const [[passkeys], [sessions]] = await Promise.all([
    db.select({ n: count() }).from(passkey).where(eq(passkey.userId, ownerId)),
    db
      .select({ n: count() })
      .from(session)
      .where(and(eq(session.userId, ownerId), gt(session.expiresAt, new Date()))),
  ]);
  return {
    audit,
    health: securityHealth(audit),
    edge: {
      configured: edgeAccessConfigured(edge),
      provider: edge.provider,
      teamDomain: edge.teamDomain,
      audiences: edge.audiences,
      allowedEmails: edge.allowedEmails,
      updatedAt: edge.updatedAt,
    },
    owner: {
      totp: owner?.totp === true,
      passkey: (passkeys?.n ?? 0) > 0,
      stepUpRequired: terminal.stepUpRequired,
      activeSessions: sessions?.n ?? 0,
    },
  };
}
