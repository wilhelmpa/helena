'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Download, FolderOpen, Paperclip } from 'lucide-react';
import { mailAttachmentUrl, type MailMessageAttachment } from '@/lib/api/endpoints/mail';
import { filesPath, homeFilesPath } from '@/utils/paths';
import { Inline } from '@/design-system';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Where the Files page shows a vault file: the project's Files page, or Home's.
function filesHref(vaultPath: string): string {
  const project = /^Projects\/([^/]+)\/(.+)$/.exec(vaultPath);
  const file = project ? project[2]! : vaultPath.replace(/^Home\//, '');
  const folder = file.slice(0, file.lastIndexOf('/'));
  return project ? filesPath(project[1]!, folder, { file }) : homeFilesPath(folder, { file });
}

// The files the sender attached. They are stored in the vault and open in the Files
// viewer; every one can be downloaded too.
export default function MailAttachmentChips({
  attachments,
}: {
  attachments: MailMessageAttachment[];
}) {
  const t = useTranslations('mail.thread');
  return (
    <Inline as="ul" gap={2} padX={4} padY={2} wrap align="stretch" className="border-t">
      {attachments.map((attachment) => {
        return (
          <Inline
            as="li"
            gap={2}
            padX={2}
            padY={1}
            key={attachment.id}
            className="rounded-md border text-xs"
          >
            <Paperclip className="size-3.5 text-muted-foreground" />
            <span dir="auto" className="max-w-56 truncate" title={attachment.vaultPath}>
              {attachment.filename}
            </span>
            <span className="text-muted-foreground">{size(attachment.size)}</span>
            <Link
              href={filesHref(attachment.vaultPath)}
              title={t('openInFiles')}
              aria-label={t('openInFiles')}
              className="text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="size-3.5" />
            </Link>
            <a
              href={mailAttachmentUrl(attachment.id)}
              title={t('download')}
              aria-label={t('download')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3.5" />
            </a>
          </Inline>
        );
      })}
    </Inline>
  );
}
