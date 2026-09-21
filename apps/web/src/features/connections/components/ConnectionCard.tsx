import { Button } from '@/components/ui/button';
import type { ConnectionItem } from '@/lib/api/endpoints/connections';
import { useTranslations } from 'next-intl';

interface Props {
  connection: ConnectionItem;
  busy: boolean;
  onAction: (action: 'probe' | 'reconnect') => void;
}

export default function ConnectionCard({ connection, busy, onAction }: Props) {
  const t = useTranslations('connections');
  const healthy = connection.status === 'connected';
  const status = {
    connected: t('status.connected'),
    available: t('status.available'),
    configured: t('status.configured'),
    disabled: t('status.disabled'),
    unavailable: t('status.unavailable'),
    unsupported: t('status.unsupported'),
    error: t('status.error'),
  }[connection.status];
  return (
    <article className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{connection.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {connection.accountId ?? connection.provider}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs ${healthy ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
        >
          {status}
        </span>
      </div>
      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>{t('lastCheck')}</dt>
          <dd>
            {connection.lastCheckedAt
              ? new Date(connection.lastCheckedAt).toLocaleString()
              : t('never')}
          </dd>
        </div>
        {connection.toolCount !== undefined ? (
          <div className="flex justify-between gap-3">
            <dt>{t('availableTools')}</dt>
            <dd>{connection.toolCount}</dd>
          </div>
        ) : null}
      </dl>
      {connection.lastError ? (
        <p className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
          {connection.lastError}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        {connection.canProbe ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('probe')}>
            {t('actions.check')}
          </Button>
        ) : null}
        {connection.canReconnect ? (
          <Button size="sm" disabled={busy} onClick={() => onAction('reconnect')}>
            {t('actions.reconnect')}
          </Button>
        ) : null}
        {connection.canPair && connection.manageUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={connection.manageUrl} target="_blank" rel="noopener noreferrer">
              {t('actions.openPairing')}
            </a>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
