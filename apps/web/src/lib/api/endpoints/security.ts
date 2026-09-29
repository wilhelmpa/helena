import { API_URL, request } from '@/lib/api/core/client';

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
    signIn: boolean;
    homeAutoConnect: boolean;
    homeUrl: string | null;
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
  // The Cloudflare sign-in: a valid Access login of an allowed identity is the Helena sign-in.
  signIn: boolean;
  // At home, the app on the public name switches to the home network's own origin.
  homeAutoConnect: boolean;
  // Service tokens acting for an allowed identity (client id only as a short hint).
  serviceTokens: { hint: string; actsAs: string; label: string }[];
  homeUrl: string | null;
  // Whether the API knows the tunnel entry's proof (cloudflare/install.sh entry-token).
  entryProof: boolean;
  updatedAt: string | null;
  configured: boolean;
}

export type EdgeAccessPatch = Partial<
  Pick<
    EdgeAccessSettings,
    'provider' | 'teamDomain' | 'audiences' | 'allowedEmails' | 'signIn' | 'homeAutoConnect'
  >
> & { removeServiceTokens?: string[] };

// A sign-in Helena opened without a password (or refused): the Cloudflare sign-in (`edge`)
// or the LAN owner sign-in (`local_owner`).
export interface SignInEvent {
  id: number;
  method: 'edge' | 'local_owner';
  outcome: 'ok' | 'refused';
  reason: string | null;
  identity: string | null;
  provider: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  userName: string | null;
  createdAt: string;
}

export interface EdgeHome {
  homeUrl: string | null;
  autoConnect: boolean;
}

export const getSecurityStatus = () => request<SecurityStatus>('/god/security/status');

export const getEdgeAccess = () => request<EdgeAccessSettings>('/god/security/edge');

export const updateEdgeAccess = (patch: EdgeAccessPatch) =>
  request<EdgeAccessSettings>('/god/security/edge', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const getSignInEvents = (method?: SignInEvent['method'], limit = 20) =>
  request<SignInEvent[]>(
    `/god/security/sign-ins?limit=${limit}${method ? `&method=${method}` : ''}`,
  );

// Public: whether the app switches to the home network's origin by itself. Asked in the
// background of every page on the public name, so it never counts as a failed request of the
// session (request() would sign out on a 401, e.g. from an expired edge login): no answer
// means "stay".
export async function getEdgeHome(): Promise<EdgeHome | null> {
  try {
    const response = await fetch(`${API_URL}/edge/home`, {
      credentials: 'include',
      cache: 'no-store',
    });
    return response.ok ? ((await response.json()) as EdgeHome) : null;
  } catch {
    return null;
  }
}
