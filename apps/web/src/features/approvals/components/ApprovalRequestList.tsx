'use client';

import { useTranslations } from 'next-intl';
import type { ApprovalListStatus } from '@/lib/api/endpoints/approvals';
import { usePaging } from '@/hooks/usePaging';
import ListPager from '@/components/common/ListPager';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useApprovals } from '../services/approvals.service';
import ApprovalRequestCard from './ApprovalRequestCard';

export default function ApprovalRequestList({
  status,
  projectKey,
}: {
  status: ApprovalListStatus;
  // Narrows the list to one project (the project's own Approvals page); left out on
  // the global page, which lists every project the reader may decide in.
  projectKey?: string;
}) {
  const t = useTranslations('approvals');
  const paging = usePaging();
  const query = useApprovals(status, paging.params, projectKey);
  const total = query.data?.total ?? 0;

  if (query.isPending) return <ListSkeleton rows={3} rowClassName="h-24" />;
  if (total === 0)
    return <EmptyState title={t(`empty.${status}`)} description={t(`emptyHint.${status}`)} />;
  return (
    <div className="space-y-3">
      {query.data?.items.map((request) => (
        <ApprovalRequestCard key={request.id} request={request} />
      ))}
      <ListPager paging={paging} total={total} />
    </div>
  );
}
