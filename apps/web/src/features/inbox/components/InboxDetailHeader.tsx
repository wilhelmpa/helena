'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { issuePath } from '@/utils/paths';
import { Inline, OverlayControls, Text } from '@/design-system';

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
    <Inline gap={2} padX={4} className="h-11 shrink-0 border-b xl:px-10">
      {isMobile && (
        <Button variant="ghost" size="sm" className="-ms-2 gap-1.5" onClick={onBack}>
          <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t('backToList')}
        </Button>
      )}
      <Text as="span" size="xs" tone="muted" className="min-w-0 flex-1 truncate">
        {projectKey}-{issueSeq}
      </Text>
      <OverlayControls
        openPageHref={issuePath(projectKey, issueSeq)}
        labels={{ openPage: openLabel }}
        size="small"
      />
    </Inline>
  );
}
