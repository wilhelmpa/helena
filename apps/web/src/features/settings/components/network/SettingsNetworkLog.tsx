'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAgentNetworkEvents } from '@/services/agentNetwork.service';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SettingsNetworkLogRow from './SettingsNetworkLogRow';

import { Text } from '@/design-system';

type DecisionFilter = 'all' | 'blocked';

// The connection log: the destinations the project's agents reached or were
// refused, newest first, 50 at a time. Never what was sent, only where and how much.
export default function SettingsNetworkLog({ projectKey }: { projectKey: string }) {
  const t = useTranslations('settings.network');
  const tCommon = useTranslations('common');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const query = useAgentNetworkEvents(projectKey, decision);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SettingsSection
      title={t('logTitle')}
      description={t('logHint')}
      action={
        <DisplaySettingsSelect
          value={decision}
          onChange={(value) => setDecision(value as DecisionFilter)}
          options={[
            { value: 'all', label: t('filterAll') },
            { value: 'blocked', label: t('filterBlocked') },
          ]}
        />
      }
    >
      {query.isPending ? (
        <ListSkeleton rows={5} rowClassName="h-10" />
      ) : query.isError ? (
        <Text as="p" size="sm" tone="danger">
          {t('loadError')}
        </Text>
      ) : items.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('columns.time')}</TableHead>
                  <TableHead>{t('columns.agent')}</TableHead>
                  <TableHead>{t('columns.target')}</TableHead>
                  <TableHead>{t('columns.decision')}</TableHead>
                  <TableHead className="text-end">{t('columns.connections')}</TableHead>
                  <TableHead className="text-end">{t('columns.data')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((event) => (
                  <SettingsNetworkLogRow key={event.id} event={event} />
                ))}
              </TableBody>
            </Table>
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? tCommon('loading') : t('loadMore')}
            </Button>
          ) : (
            <Text as="p" size="xs" tone="muted" className="text-center">
              {t('endOfLog')}
            </Text>
          )}
        </>
      )}
    </SettingsSection>
  );
}
