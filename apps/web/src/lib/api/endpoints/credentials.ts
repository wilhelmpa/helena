import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

export type CredentialKind = 'web_login' | 'api_key' | 'ssh_key' | 'secret';

// A web login, API key, SSH key or secret of the team. The secret fields are write-only:
// `secrets` names those that hold a value, the values never arrive here.
export interface CredentialEntry {
  id: number;
  teamId: number;
  kind: CredentialKind;
  label: string;
  // Null for a credential of the whole team.
  projectId: number | null;
  projectKey: string | null;
  loginUrl: string | null;
  // The origins a login may be filled on besides the login URL's.
  allowedDomains: string[];
  username: string | null;
  notes: string;
  publicKey: string | null;
  secrets: string[];
  // The agents that may use it.
  agentIds: number[];
  createdAt: string;
  updatedAt: string;
}

// A secret field left out keeps its value; totpSecret null removes the authenticator key.
export interface CredentialInput {
  label?: string;
  projectId?: number | null;
  loginUrl?: string;
  allowedDomains?: string[];
  username?: string;
  password?: string;
  totpSecret?: string | null;
  value?: string;
  notes?: string;
}

export interface NewCredentialInput extends CredentialInput {
  kind: CredentialKind;
  label: string;
}

// One entry of a credential's audit log: a delivery to an agent's runner, or a login the
// agent filled.
export interface CredentialUse {
  id: number;
  action: 'delivered' | 'used';
  purpose: string;
  agentId: number | null;
  agentName: string;
  runId: number | null;
  issueIdentifier: string | null;
  chatMessageId: number | null;
  createdAt: string;
}

export const listCredentials = (teamId: number, params: PageParams, kind?: CredentialKind) =>
  request<Page<CredentialEntry>>(`/teams/${teamId}/credentials${pageQuery(params, { kind })}`);

export const createCredential = (teamId: number, input: NewCredentialInput) =>
  request<CredentialEntry>(`/teams/${teamId}/credentials`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateCredential = (teamId: number, id: number, input: CredentialInput) =>
  request<CredentialEntry>(`/teams/${teamId}/credentials/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteCredential = (teamId: number, id: number) =>
  request<void>(`/teams/${teamId}/credentials/${id}`, { method: 'DELETE' });

export const setCredentialGrants = (teamId: number, id: number, agentIds: number[]) =>
  request<CredentialEntry>(`/teams/${teamId}/credentials/${id}/grants`, {
    method: 'PUT',
    body: JSON.stringify({ agentIds }),
  });

export const regenerateSshKey = (teamId: number, id: number) =>
  request<CredentialEntry>(`/teams/${teamId}/credentials/${id}/ssh-key`, { method: 'POST' });

export const listCredentialUses = (teamId: number, id: number, params: PageParams) =>
  request<Page<CredentialUse>>(`/teams/${teamId}/credentials/${id}/uses${pageQuery(params)}`);
