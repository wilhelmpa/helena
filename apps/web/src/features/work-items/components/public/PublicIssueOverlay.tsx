'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSharedViewIssue } from '@/lib/api/endpoints/share';
import { Overlay } from '@/design-system';
import IssueDetailSkeleton from '@/features/issue/components/detail/IssueDetailSkeleton';
import ReadOnlyIssueDetail from '@/features/issue/components/detail/ReadOnlyIssueDetail';

// The read-only issue detail opened from a shared board card. It fetches the issue
// under the board's own share token (the API checks the issue belongs to the shared
// view's project) and renders it in the one overlay, large at first. Composing the issue feature's
// read-only detail is the allowed work-items → issue direction.
export default function PublicIssueOverlay({
  token,
  issueId,
  extended,
  onOpenIssue,
  onClose,
}: {
  token: string;
  issueId: number | null;
  // Whether the board's link exposes the full issues; without it the bundle
  // carries no activity and no custom fields.
  extended: boolean;
  // Swaps the open issue for another one of the same board, so a subtask or the
  // other end of a relation opens in place.
  onOpenIssue: (id: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('workItems.share');
  const query = useQuery({
    queryKey: ['share', 'view', token, 'issue', issueId],
    queryFn: () => getSharedViewIssue(token, issueId as number),
    enabled: issueId != null,
    retry: false,
  });

  if (issueId == null) return null;
  return (
    <Overlay
      label={t('issueTitle')}
      tabs={[{ id: 'issue', label: t('issueTitle') }]}
      onClose={onClose}
      startFull
      bodyClassName="is-flush"
    >
      {query.isLoading && (
        <div className="px-8 py-2">
          <IssueDetailSkeleton />
        </div>
      )}
      {(query.isError || (!query.isLoading && !query.data)) && (
        <p className="p-8 text-sm text-muted-foreground">{t('issueUnavailable')}</p>
      )}
      {query.data && (
        <ReadOnlyIssueDetail bundle={query.data} extended={extended} onOpenIssue={onOpenIssue} />
      )}
    </Overlay>
  );
}
