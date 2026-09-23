'use client';

import { useTranslations } from 'next-intl';
import { ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailAddress, MailMessage } from '@/lib/api/endpoints/mail';
import { formatDateTime } from '@/utils/dates';
import { useRemoteImages } from '../services/mail.service';
import MailAttachmentChips from './MailAttachmentChips';
import MailHtmlFrame from './MailHtmlFrame';

function names(list: MailAddress[]): string {
  return list.map((item) => item.name || item.address).join(', ');
}

export default function MailMessageCard({
  message,
  threadId,
}: {
  message: MailMessage;
  threadId: number;
}) {
  const t = useTranslations('mail.thread');
  const remote = useRemoteImages(threadId);
  const blocked = message.hasRemoteImages && !message.allowRemoteImages;
  return (
    <article className="rounded-lg border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-4 py-2 text-sm">
        <span dir="auto" className="font-medium">
          {message.fromName || message.fromAddress}
        </span>
        {message.fromName && (
          <span className="text-xs text-muted-foreground">{message.fromAddress}</span>
        )}
        <time className="ms-auto text-xs text-muted-foreground" dateTime={message.sentAt}>
          {formatDateTime(message.sentAt)}
        </time>
        <span dir="auto" className="w-full truncate text-xs text-muted-foreground">
          {t('to', { names: names(message.to) })}
          {message.cc.length > 0 && ` · ${t('cc', { names: names(message.cc) })}`}
          {message.bcc.length > 0 && ` · ${t('bcc', { names: names(message.bcc) })}`}
        </span>
      </header>
      {blocked && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          <ImageOff className="size-3.5" />
          {t('remoteBlocked')}
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={remote.isPending}
            onClick={() => remote.mutate({ messageId: message.id, allow: true })}
          >
            {t('showRemote')}
          </Button>
        </div>
      )}
      <div className="px-4 py-3">
        {message.html ? (
          <MailHtmlFrame html={message.html} allowRemoteImages={message.allowRemoteImages} />
        ) : (
          <p dir="auto" className="text-sm break-words whitespace-pre-wrap">
            {message.text}
          </p>
        )}
      </div>
      {message.attachments.length > 0 && <MailAttachmentChips attachments={message.attachments} />}
    </article>
  );
}
