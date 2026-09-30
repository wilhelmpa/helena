'use client';

import { useTranslations } from 'next-intl';
import { ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailAddress, MailMessage } from '@/lib/api/endpoints/mail';
import { formatDateTime } from '@/utils/dates';
import { useRemoteImages } from '../services/mail.service';
import MailAttachmentChips from './MailAttachmentChips';
import MailHtmlFrame from './MailHtmlFrame';
import { Box, Inline, Text, Card } from '@/design-system';

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
    <Card as="article" pad="none">
      <Box
        as="header"
        padX={4}
        padY={2}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b text-sm"
      >
        <span dir="auto" className="font-medium">
          {message.fromName || message.fromAddress}
        </span>
        {message.fromName && (
          <Text as="span" size="xs" tone="muted">
            {message.fromAddress}
          </Text>
        )}
        <time className="ms-auto text-xs text-muted-foreground" dateTime={message.sentAt}>
          {formatDateTime(message.sentAt)}
        </time>
        <Text as="span" size="xs" tone="muted" dir="auto" className="w-full truncate">
          {t('to', { names: names(message.to) })}
          {message.cc.length > 0 && ` · ${t('cc', { names: names(message.cc) })}`}
          {message.bcc.length > 0 && ` · ${t('bcc', { names: names(message.bcc) })}`}
        </Text>
      </Box>
      {blocked && (
        <Inline
          gap={2}
          padX={4}
          padY={2}
          className="border-b bg-muted/40 text-xs text-muted-foreground"
        >
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
        </Inline>
      )}
      <Box padX={4} padY={3}>
        {message.html ? (
          <MailHtmlFrame html={message.html} allowRemoteImages={message.allowRemoteImages} />
        ) : (
          <Text as="p" size="sm" dir="auto" className="break-words whitespace-pre-wrap">
            {message.text}
          </Text>
        )}
      </Box>
      {message.attachments.length > 0 && <MailAttachmentChips attachments={message.attachments} />}
    </Card>
  );
}
