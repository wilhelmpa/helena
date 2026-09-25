import { request } from '@/lib/api/core/client';

// Administrator → Sicherheit: the host audit and the edge sign-in (Cloudflare Access).
// Mirrors apps/api/src/modules/edge-access.

export type AuditState = 'pass' | 'fail' | 'warn' | 'skip';
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditCheck {
  id: string;
  group: string;
  state: AuditState;
  severity: AuditSeverity;
  // The finding's stable name (`<id>.<state>`) and the values its sentence fills in; the
  // page words it from serverSecurity.finding. `detail` is the audit's English fact, shown
  // only as a tooltip.
  code?: string;
  params?: Record<string, string | number>;
  detail: string;
}

export interface SecurityStatus {
  audit: {
    ranAt: string;
    host: string;
    stale: boolean;
    summary: Record<AuditState, number>;
    checks: AuditCheck[];
  } | null;
  health: {
    id: string;
    state: 'ok' | 'attention' | 'critical' | 'unknown';
    code: string;
    values: Record<string, number>;
  };
  edge: {
    configured: boolean;
    provider: string;
    teamDomain: string;
    audiences: string[];
    allowedEmails: string[];
    updatedAt: string | null;
  };
  owner: {
    totp: boolean;
    passkey: boolean;
    stepUpRequired: boolean;
    activeSessions: number;
  };
}

export interface EdgeAccessSettings {
  provider: string;
  teamDomain: string;
  audiences: string[];
  allowedEmails: string[];
  updatedAt: string | null;
  configured: boolean;
}

export type EdgeAccessPatch = Partial<
  Pick<EdgeAccessSettings, 'provider' | 'teamDomain' | 'audiences' | 'allowedEmails'>
>;

export const getSecurityStatus = () => request<SecurityStatus>('/god/security/status');

export const getEdgeAccess = () => request<EdgeAccessSettings>('/god/security/edge');

export const updateEdgeAccess = (patch: EdgeAccessPatch) =>
  request<EdgeAccessSettings>('/god/security/edge', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
