import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

// The access center: grants of any credential or connector account, the team's audit
// log, Google accounts with their OAuth clients and services, and clone jobs of SSH keys.
// Secrets never arrive here: a response names which are set, never their values.

export type GrantAccess = 'read' | 'write';

export interface Grant {
  id: number;
  agentId: number | null;
  agentName: string | null;
  projectId: number | null;
  projectKey: string | null;
  service: string | null;
  access: GrantAccess;
}

export interface GrantInput {
  agentId?: number | null;
  projectId?: number | null;
  service?: string | null;
  access?: GrantAccess;
}

export type AuditAction = 'delivered' | 'used' | 'called' | 'denied' | 'approval' | 'changed';

export interface AuditEntry {
  id: number;
  credentialId: number | null;
  credentialLabel: string;
  action: AuditAction;
  category: string | null;
  purpose: string;
  agentId: number | null;
  agentName: string;
  runId: number | null;
  issueIdentifier: string | null;
  chatMessageId: number | null;
  createdAt: string;
}

export type GoogleEngine = 'helena' | 'gog';
export type GoogleService =
  'mail' | 'calendar' | 'drive' | 'docs' | 'sheets' | 'contacts' | 'tasks';
export const GOOGLE_SERVICES: GoogleService[] = [
  'mail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'contacts',
  'tasks',
];

export interface GoogleAccount {
  id: number;
  label: string;
  email: string;
  engine: GoogleEngine;
  clientCredentialId: number | null;
  projectId: number | null;
  projectKey: string | null;
  services: { id: GoogleService; enabled: boolean; granted: boolean }[];
  status: 'ok' | 'needs_auth' | 'error' | null;
  statusDetail: string | null;
  checkedAt: string | null;
  signedIn: boolean;
  grants: Grant[];
  mail: {
    accountId: number;
    enabled: boolean;
    fetchDays: number | null;
    syncStatus: string;
    syncError: string | null;
  } | null;
  createdAt: string;
}

export interface GoogleClient {
  id: number;
  label: string;
  clientId: string;
  projectId: string | null;
  type: 'installed' | 'web';
  accounts: number;
  createdAt: string;
}

export interface GoogleOverview {
  accounts: GoogleAccount[];
  clients: GoogleClient[];
  gogAvailable: boolean;
  callbackAvailable: boolean;
}

export interface SignInInput {
  engine: GoogleEngine;
  clientCredentialId?: number;
  email?: string;
  services: GoogleService[];
  projectId?: number | null;
  accountId?: number;
  removeFromGog?: boolean;
}

export interface SignInStart {
  sessionId: string;
  url: string;
  mode: 'paste' | 'callback';
}

export interface GogStatus {
  available: boolean;
  unlisted: { email: string; services: string[]; ok: boolean }[];
}

export interface CloneInput {
  projectId: number;
  areaId?: number | null;
  url: string;
  agentId?: number;
}

export interface CloneStarted {
  runId: number;
  agentId: number;
  agentName: string;
  folder: string;
  name: string;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const setGrants = (teamId: number, credentialId: number, grants: GrantInput[]) =>
  request<{ grants: Grant[] }>(`/teams/${teamId}/credentials/${credentialId}/grants`, {
    method: 'PUT',
    ...json({ grants }),
  });

export const listAudit = (
  teamId: number,
  params: PageParams,
  filter: { credentialId?: number; action?: AuditAction } = {},
) =>
  request<Page<AuditEntry>>(
    `/teams/${teamId}/access/audit${pageQuery(params, {
      credentialId: filter.credentialId === undefined ? undefined : String(filter.credentialId),
      action: filter.action,
    })}`,
  );

export const getGoogle = (teamId: number) =>
  request<GoogleOverview>(`/teams/${teamId}/connectors/google`);

export const importGoogleClient = (
  teamId: number,
  input: { json: string; label?: string; engine?: GoogleEngine },
) =>
  request<{ client: GoogleClient | null }>(`/teams/${teamId}/connectors/google/clients`, {
    method: 'POST',
    ...json(input),
  });

export const deleteGoogleClient = (teamId: number, id: number) =>
  request<void>(`/teams/${teamId}/connectors/google/clients/${id}`, { method: 'DELETE' });

export const startGoogleSignIn = (teamId: number, input: SignInInput) =>
  request<SignInStart>(`/teams/${teamId}/connectors/google/sign-in`, {
    method: 'POST',
    ...json(input),
  });

export const finishGoogleSignIn = (
  teamId: number,
  input: { sessionId: string; redirectUrl: string },
) =>
  request<GoogleAccount>(`/teams/${teamId}/connectors/google/sign-in/finish`, {
    method: 'POST',
    ...json(input),
  });

export const updateGoogleAccount = (
  teamId: number,
  id: number,
  input: { label?: string; projectId?: number | null; services?: GoogleService[] },
) =>
  request<GoogleAccount>(`/teams/${teamId}/connectors/google/accounts/${id}`, {
    method: 'PATCH',
    ...json(input),
  });

export const checkGoogleAccount = (teamId: number, id: number) =>
  request<GoogleAccount>(`/teams/${teamId}/connectors/google/accounts/${id}/check`, {
    method: 'POST',
  });

export const deleteGoogleAccount = (teamId: number, id: number, fromGog = false) =>
  request<void>(
    `/teams/${teamId}/connectors/google/accounts/${id}${fromGog ? '?fromGog=true' : ''}`,
    { method: 'DELETE' },
  );

export const getGogStatus = (teamId: number) =>
  request<GogStatus>(`/teams/${teamId}/connectors/google/gog`);

export const adoptGogAccount = (
  teamId: number,
  input: { email: string; projectId?: number | null },
) =>
  request<GoogleAccount>(`/teams/${teamId}/connectors/google/gog/adopt`, {
    method: 'POST',
    ...json(input),
  });

export const startClone = (teamId: number, credentialId: number, input: CloneInput) =>
  request<CloneStarted>(`/teams/${teamId}/credentials/${credentialId}/clone`, {
    method: 'POST',
    ...json(input),
  });
