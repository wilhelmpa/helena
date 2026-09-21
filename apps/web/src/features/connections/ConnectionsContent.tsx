'use client';

import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import ConnectionCard from './components/ConnectionCard';
import SecretStorePanel from './components/SecretStorePanel';
import {
  useConnectionAction,
  useConnectionsQuery,
  useMailAccountsQuery,
} from './services/connections.service';

export default function ConnectionsContent() {
  const t = useTranslations('connections');
  const connections = useConnectionsQuery();
  const mail = useMailAccountsQuery();
  const action = useConnectionAction();
  const items = [
    ...(connections.data?.items ?? []),
    ...(mail.data?.accounts ?? []).map((item) => ({
      id: `mail:${item.account}`,
      kind: 'mail' as const,
      provider: 'google-mail',
      label: 'Google Mail',
      accountId: item.account,
      status: item.status,
      configured: true,
      connected: item.status === 'connected',
      running: item.status === 'connected',
      lastCheckedAt: item.lastCheckedAt,
      lastSuccessAt: item.status === 'connected' ? item.lastCheckedAt : null,
      lastError: item.lastError,
      canProbe: false,
      canReconnect: false,
      canPair: false,
    })),
  ];

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={action.isPending}
          onClick={() => action.mutate({ id: 'all', action: 'probe' })}
        >
          {t('actions.checkAll')}
        </Button>
      </div>
      {connections.error || mail.error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : null}
      {connections.isPending || mail.isPending ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
        {items.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            busy={action.isPending}
            onAction={(requested) => action.mutate({ id: connection.id, action: requested })}
          />
        ))}
      </div>
      <SecretStorePanel />
    </div>
  );
}
