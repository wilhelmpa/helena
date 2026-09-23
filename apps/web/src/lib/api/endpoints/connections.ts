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
export const runConnectionAction = (id: string, action: 'probe' | 'reconnect') =>
  request<ConnectionsSnapshot>('/connections/actions', {
    method: 'POST',
    body: JSON.stringify({ id, action }),
  });
