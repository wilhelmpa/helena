'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { issuePath } from '@/utils/paths';
import { Button, OverlayHead } from '@/design-system';

export default function InboxDetailHeader({
  projectKey,
  issueSeq,
  isMobile,
  onBack,
}: {
  projectKey: string;
  issueSeq: number;
  isMobile: boolean;
  onBack: () => void;
}) {
  const t = useTranslations('inbox');
  const tIssue = useTranslations('issue');
  const openLabel = tIssue('openAsPage');

  return (
    <OverlayHead
      label={`${projectKey}-${issueSeq}`}
      tabs={[{ id: 'issue', label: `${projectKey}-${issueSeq}` }]}
      lead={
        isMobile ? (
          <Button
            icon={<ChevronLeft className="rtl:rotate-180" />}
            variant="ghost"
            onClick={onBack}
          >
            {t('backToList')}
          </Button>
        ) : undefined
      }
      controls={{ openPageHref: issuePath(projectKey, issueSeq), labels: { openPage: openLabel } }}
    />
  );
}
