'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FolderInput, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailThread } from '@/lib/api/endpoints/mail';
import { issuePath } from '@/utils/paths';
import { useMoveThread } from '../services/mail.service';
import { MailClassificationCard } from './MailClassificationCard';
import { Inline, Stack } from '@/design-system';

export default function MailThreadHeader({
  thread,
  onMove,
}: {
  thread: MailThread;
  onMove: () => void;
}) {
  const t = useTranslations('mail.thread');
  const move = useMoveThread();
  return (
    <Stack gap={2}>
      <h2 dir="auto" className="text-base font-semibold break-words">
        {thread.subject || t('noSubject')}
      </h2>
      <Inline gap={2} wrap className="text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onMove}
          className="flex items-center gap-1 rounded-sm border px-1.5 py-0.5 hover:bg-accent"
          title={t('moveHint')}
        >
          <FolderInput className="size-3" />
          {thread.projectName ?? t('home')}
        </button>
        <span>{t('account', { address: thread.accountAddress })}</span>
        {thread.issues.map((issue) => (
          <Link
            key={issue.id}
            href={issuePath(issue.projectKey, issue.sequenceNumber)}
            className="rounded-sm border px-1.5 py-0.5 hover:bg-accent"
          >
            {issue.identifier} {issue.title}
          </Link>
        ))}
      </Inline>
      {thread.suggestedProjectId != null && (
        <Inline gap={2} padX={3} padY={2} wrap className="rounded-md border border-dashed text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          <span>{t('suggestion', { project: thread.suggestedProjectName ?? '' })}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ms-auto"
            disabled={move.isPending}
            onClick={() =>
              move.mutate({ threadId: thread.id, projectId: thread.suggestedProjectId })
            }
          >
            {t('acceptSuggestion')}
          </Button>
        </Inline>
      )}
      <MailClassificationCard threadId={thread.id} />
    </Stack>
  );
}
