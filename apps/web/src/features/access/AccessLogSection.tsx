'use client';

import { Card } from '@/design-system';
import { useState, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ListPager from '@/components/common/ListPager';
import { EmptyState } from '@/components/common/page/EmptyState';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageSelect, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { usePaging } from '@/hooks/usePaging';
import type { AuditAction } from '@/lib/api/endpoints/access';
import { useAuditQuery } from '@/services/access.service';
import { AuditRow } from './AuditRow';

const ACTIONS: AuditAction[] = ['called', 'denied', 'approval', 'used', 'delivered', 'changed'];

// The audit log of the whole team: every delivery, login fill, connector tool call,
// denial, approval request and change of the owner, newest first.
export function AccessLogSection({ teamId, leading }: { teamId: number; leading: ReactNode }) {
  const t = useTranslations('access.log');
  const tAccess = useTranslations('access');
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const paging = usePaging();
  const audit = useAuditQuery(teamId, paging.params, {
    action: action === 'all' ? undefined : action,
  }).data;

  return (
    <SectionPageView title={tAccess('tabs.log')} wide>
      <PageToolbar>
        {leading}
        <PageToolbarSpacer />
        <PageSelect
          label={t('filter')}
          icon={ListFilter}
          value={action}
          defaultValue="all"
          onChange={(next) => {
            setAction(next);
            paging.reset();
          }}
          options={[
            { value: 'all', label: t('all') },
            ...ACTIONS.map((value) => ({ value, label: t(`actions.${value}`) })),
          ]}
        />
      </PageToolbar>
      {!audit ? (
        <ListSkeleton rows={5} rowClassName="h-12" />
      ) : audit.total === 0 ? (
        <EmptyState title={t('empty')} description="" />
      ) : (
        <div className="flex flex-col gap-4">
          <Card as="ul" pad="none" className="divide-y overflow-hidden">
            {audit.items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} showCredential />
            ))}
          </Card>
          <ListPager paging={paging} total={audit.total} />
        </div>
      )}
    </SectionPageView>
  );
}
