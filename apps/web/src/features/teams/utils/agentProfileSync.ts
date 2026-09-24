import type {
  RuntimeDrift,
  RuntimeSync,
  RuntimeSyncState,
} from '@/lib/api/endpoints/agentRuntimeSync';
import type { Status } from '@/components/common/page/StatusBadge';

// The dot of a sync state: green in sync, amber while the runner catches up or found
// drift, red when it could not apply the settings, grey without a runner.
export function syncStatus(state: RuntimeSyncState): Status {
  switch (state) {
    case 'synced':
      return 'success';
    case 'drift':
    case 'pending':
      return 'waiting';
    case 'degraded':
      return 'danger';
    default:
      return 'idle';
  }
}

// The server a drift key names ("mcp_servers.browser-harness"), or null for a setting.
export function driftServer(drift: RuntimeDrift): string | null {
  return drift.key.startsWith('mcp_servers.') ? drift.key.slice('mcp_servers.'.length) : null;
}

// Helena's servers the runtime starts first, then the ones of its own configuration that
// Helena turned off.
export function profileServers(sync: RuntimeSync | undefined) {
  const servers = sync?.profile?.mcpServers ?? [];
  return {
    managed: servers.filter((server) => server.managed).map((server) => server.name),
    turnedOff: servers.filter((server) => !server.managed).map((server) => server.name),
  };
}
