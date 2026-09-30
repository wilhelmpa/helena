'use client';

import { useTranslations } from 'next-intl';
import { FolderInput, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailThread } from '@/lib/api/endpoints/mail';
import { issuePath } from '@/utils/paths';
import { useMoveThread } from '../services/mail.service';
import { MailClassificationCard } from './MailClassificationCard';
import { Inline, Stack, PillButton, PillLink, Notice } from '@/design-system';

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
        <PillButton size="sm" onClick={onMove} title={t('moveHint')} icon={<FolderInput />}>
          {thread.projectName ?? t('home')}
        </PillButton>
        <span>{t('account', { address: thread.accountAddress })}</span>
        {thread.issues.map((issue) => (
          <PillLink
            size="sm"
            key={issue.id}
            href={issuePath(issue.projectKey, issue.sequenceNumber)}
          >
            {issue.identifier} {issue.title}
          </PillLink>
        ))}
      </Inline>
      {thread.suggestedProjectId != null && (
        <Notice
          icon={<Sparkles />}
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={move.isPending}
              onClick={() =>
                move.mutate({ threadId: thread.id, projectId: thread.suggestedProjectId })
              }
            >
              {t('acceptSuggestion')}
            </Button>
          }
        >
          {t('suggestion', { project: thread.suggestedProjectName ?? '' })}
        </Notice>
      )}
      <MailClassificationCard threadId={thread.id} />
    </Stack>
  );
}
