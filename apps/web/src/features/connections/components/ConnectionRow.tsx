import { useTranslations } from 'next-intl';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import type { ConnectionItem, ConnectionStatus } from '@/lib/api/endpoints/connections';
import { formatDateTime } from '@/utils/dates';

const STATUS: Record<ConnectionStatus, Status> = {
  connected: 'success',
  available: 'idle',
  configured: 'idle',
  disabled: 'idle',
  unavailable: 'waiting',
  unsupported: 'idle',
  error: 'danger',
};

// One connection: its name and account, its health, when it was last checked, and
// what can be done about it.
export default function ConnectionRow({
  connection,
  busy,
  onAction,
}: {
  connection: ConnectionItem;
  busy: boolean;
  onAction: (action: 'probe' | 'reconnect') => void;
}) {
  const t = useTranslations('connections');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate font-medium">{connection.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {connection.accountId ?? connection.provider}
        </p>
        {connection.lastError ? (
          <p className="mt-1 text-xs break-words text-destructive">{connection.lastError}</p>
        ) : null}
      </div>
      <StatusBadge status={STATUS[connection.status]}>
        {t(`status.${connection.status}`)}
      </StatusBadge>
      <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
        {t('lastCheck')}:{' '}
        {connection.lastCheckedAt ? formatDateTime(connection.lastCheckedAt) : t('never')}
      </span>
      {connection.toolCount !== undefined ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t('toolCount', { count: connection.toolCount })}
        </span>
      ) : null}
      <div className="flex shrink-0 gap-1">
        {connection.canProbe ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction('probe')}>
            {t('actions.check')}
          </Button>
        ) : null}
        {connection.canReconnect ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('reconnect')}>
            {t('actions.reconnect')}
          </Button>
        ) : null}
        {connection.canPair && connection.manageUrl ? (
          <Button size="sm" variant="ghost" asChild>
            <a href={connection.manageUrl} target="_blank" rel="noopener noreferrer">
              {t('actions.openPairing')}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
