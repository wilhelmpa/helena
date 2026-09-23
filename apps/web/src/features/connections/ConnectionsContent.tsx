'use client';

import SectionPageView from '@/components/common/page/SectionPageView';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import ConnectionCard from './components/ConnectionCard';
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

  const actions = (
    <Button
      variant="outline"
      disabled={action.isPending}
      onClick={() => action.mutate({ id: 'all', action: 'probe' })}
    >
      {t('actions.checkAll')}
    </Button>
  );

  return (
    <SectionPageView title={t('title')} description={t('description')} actions={actions}>
      <div className="space-y-5">
        {connections.error || mail.error ? (
          <p className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
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
      </div>
    </SectionPageView>
  );
}
