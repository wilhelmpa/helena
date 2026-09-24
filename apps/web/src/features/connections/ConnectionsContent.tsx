'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { KeyRound, Laptop, Mail, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { credentialsPath, devicesPath, mailAccountsPath } from '@/utils/paths';
import ConnectionRow from './components/ConnectionRow';
import { useConnectionAction, useConnectionsQuery } from './services/connections.service';

// The host's connections (MCP servers, channels, services) and their live health. On a
// server without the connections service the page says so and points to the pages
// that hold the accounts instead; it never shows an empty page.
// In the access center the area's tabs lead the header row (`leading`), and the accounts
// sit in those tabs, so only the devices page gets a link.
export default function ConnectionsContent({
  embedded = false,
  leading,
}: {
  embedded?: boolean;
  leading?: ReactNode;
}) {
  const t = useTranslations('connections');
  const connections = useConnectionsQuery();
  const action = useConnectionAction();
  const items = connections.data?.items ?? [];
  const canCheck = !!connections.data?.configured && items.length > 0;
  const checkAll = () => action.mutate({ id: 'all', action: 'probe' });

  const body = connections.isPending ? (
    <ListSkeleton rows={3} rowClassName="h-12" />
  ) : connections.isError ? (
    <EmptyState title={t('loadError')} description={t('loadErrorHint')}>
      <Button size="sm" variant="outline" onClick={() => void connections.refetch()}>
        {t('actions.retry')}
      </Button>
    </EmptyState>
  ) : !connections.data?.configured ? (
    <EmptyState
      title={t('unconfigured.title')}
      description={t(leading ? 'unconfigured.hintAccess' : 'unconfigured.hint')}
    >
      <div className="flex flex-wrap justify-center gap-2">
        {!leading && (
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href={mailAccountsPath()}>
                <Mail />
                {t('unconfigured.mail')}
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={credentialsPath()}>
                <KeyRound />
                {t('unconfigured.credentials')}
              </Link>
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link href={devicesPath()}>
            <Laptop />
            {t('unconfigured.devices')}
          </Link>
        </Button>
      </div>
    </EmptyState>
  ) : items.length === 0 ? (
    <EmptyState title={t('empty')} description={t('emptyHint')} />
  ) : (
    <div className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
      {items.map((connection) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          busy={action.isPending}
          onAction={(requested) => action.mutate({ id: connection.id, action: requested })}
        />
      ))}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {canCheck ? (
          <Button
            size="sm"
            variant="outline"
            className="self-end"
            disabled={action.isPending}
            onClick={checkAll}
          >
            <RefreshCw />
            {t('actions.checkAll')}
          </Button>
        ) : null}
        {body}
      </div>
    );
  }

  return (
    <SectionPageView title={t('title')} wide>
      {canCheck || leading ? (
        <PageToolbar>
          {leading}
          <PageToolbarSpacer />
          {canCheck && (
            <PageActions
              actions={[
                {
                  id: 'check-all',
                  label: t('actions.checkAll'),
                  icon: RefreshCw,
                  disabled: action.isPending,
                  onClick: checkAll,
                },
              ]}
            />
          )}
        </PageToolbar>
      ) : null}
      {body}
    </SectionPageView>
  );
}
