'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIssueMailThreads, useStartDraft } from '@/services/mail.service';
import { formatDateTime } from '@/utils/dates';
import { inboxPath } from '@/utils/paths';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import IssueSectionHeading from './IssueSectionHeading';

// The mail threads the task was made from or linked to; an answer is written in the
// compose panel and stays linked to the task.
export default function IssueMailsPanel({
  teamId,
  projectKey,
  issueId,
}: {
  teamId: number;
  projectKey: string;
  issueId: number;
}) {
  const t = useTranslations('mail.issue');
  const { open, toggle } = usePersistedOpen('issue-mails-open');
  const threads = useIssueMailThreads(issueId);
  const reply = useStartDraft(teamId);
  if ((threads.data ?? []).length === 0) return null;

  return (
    <div className={`mt-6 border-t pt-5 ${open ? '' : '-mb-2'}`}>
      <div className={`flex h-7 items-center gap-2 ${open ? 'mb-3' : ''}`}>
        <IssueSectionHeading
          label={t('title')}
          tally={String(threads.data!.length)}
          open={open}
          onToggle={toggle}
        />
      </div>
      {open && (
        <ul className="flex flex-col gap-2">
          {threads.data!.map((thread) => (
            <li
              key={thread.id}
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Link
                href={`${inboxPath(projectKey)}?thread=${thread.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <span dir="auto" className="block truncate font-medium">
                  {thread.subject || t('noSubject')}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {thread.fromName || thread.fromAddress} · {formatDateTime(thread.lastMessageAt)}
                </span>
                <span dir="auto" className="block truncate text-xs text-muted-foreground">
                  {thread.snippet}
                </span>
              </Link>
              {thread.latestMessageId != null && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={reply.isPending}
                  onClick={() =>
                    reply.mutate({ mode: 'reply', messageId: thread.latestMessageId!, issueId })
                  }
                >
                  <Reply />
                  {t('reply')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
