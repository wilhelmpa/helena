'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

// The thread's transcript could not be read (the connection dropped, or the chat is no
// longer the reader's): said so, with a way to try again, instead of an empty chat that
// looks like it never had messages.
export default function ChatRestoreError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('chatWorkspace');

  return (
    <Empty className="min-h-0 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>{t('messages.restoreFailedTitle')}</EmptyTitle>
        <EmptyDescription>{t('messages.restoreFailed')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="size-4" /> {t('messages.retry')}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
