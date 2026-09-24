import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { Grant } from './access';

export type CredentialKind = 'web_login' | 'api_key' | 'ssh_key' | 'secret';
// What the page lists: the kinds above and MCP servers signed in with OAuth.
export type ListedKind = CredentialKind | 'mcp_oauth';

// A web login, API key, SSH key or secret of the team. The secret fields are write-only:
// `secrets` names those that hold a value, the values never arrive here.
export interface CredentialEntry {
  id: number;
  teamId: number;
  kind: ListedKind;
  label: string;
  // mcp_oauth: the server and the health of its sign-in.
  serverUrl: string | null;
  status: 'ok' | 'needs_auth' | 'error' | null;
  statusDetail: string | null;
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
  // The agents granted by name; `grants` holds every grant, to agents and projects.
  agentIds: number[];
  grants: Grant[];
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

export const listCredentials = (teamId: number, params: PageParams, kind?: ListedKind) =>
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

export const regenerateSshKey = (teamId: number, id: number) =>
  request<CredentialEntry>(`/teams/${teamId}/credentials/${id}/ssh-key`, { method: 'POST' });
