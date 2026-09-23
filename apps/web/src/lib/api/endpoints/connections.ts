import { request } from '@/lib/api/core/client';

export type ConnectionStatus =
  'connected' | 'available' | 'configured' | 'disabled' | 'unavailable' | 'unsupported' | 'error';

export interface ConnectionItem {
  id: string;
  kind: 'mcp' | 'channel' | 'service' | 'mail';
  provider: string;
  label: string;
  accountId?: string;
  status: ConnectionStatus;
  configured: boolean;
  connected: boolean;
  running: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  canProbe: boolean;
  canReconnect: boolean;
  canPair: boolean;
  toolCount?: number;
  manageUrl?: string | null;
}

export interface ConnectionsSnapshot {
  checkedAt: string;
  items: ConnectionItem[];
}

export const getConnections = () => request<ConnectionsSnapshot>('/connections');
export interface VaultStatus {
  checkedAt: string;
  accessUrl: string | null;
  accessStatus: 'protected' | 'reachable' | 'unavailable' | 'unconfigured';
  httpStatus: number | null;
  serviceHealthExposed: false;
  secretValuesExposed: false;
}

export const getVaultStatus = () => request<VaultStatus>('/vault/status', { cache: 'no-store' });
export const runConnectionAction = (id: string, action: 'probe' | 'reconnect') =>
  request<ConnectionsSnapshot>('/connections/actions', {
    method: 'POST',
    body: JSON.stringify({ id, action }),
  });
export interface ThemeSyncResult {
  theme: 'light' | 'dark';
  results: Array<{
    service: 'agent_runtime' | 'code' | 'nextcloud';
    status: 'updated' | 'failed';
    attempts: number;
    error?: string;
  }>;
}

export const syncWorkspaceTheme = (theme: 'light' | 'dark') =>
  request<ThemeSyncResult>('/theme/sync', {
    method: 'POST',
    body: JSON.stringify({ theme }),
  });

export interface SecretInventory {
  checkedAt: string;
  entries: Array<{ name: string; updatedAt: string | null; allowedHosts: string[] }>;
}
export const getSecretInventory = () =>
  request<SecretInventory>('/connections/secrets', { cache: 'no-store' });
export const setSecret = (input: { name: string; value: string; allowedHosts: string[] }) =>
  request<SecretInventory>('/connections/secrets', {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
