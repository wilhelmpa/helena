'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Download, FolderOpen, Paperclip } from 'lucide-react';
import { mailAttachmentUrl, type MailMessageAttachment } from '@/lib/api/endpoints/mail';
import { filesPath } from '@/utils/paths';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The files the sender attached. They are stored in the vault; a project's are opened
// in its Files page at their folder, and every one can be downloaded.
export default function MailAttachmentChips({
  attachments,
  projectKey,
}: {
  attachments: MailMessageAttachment[];
  projectKey: string | null;
}) {
  const t = useTranslations('mail.thread');
  return (
    <ul className="flex flex-wrap gap-2 border-t px-4 py-2">
      {attachments.map((attachment) => {
        const folder = attachment.vaultPath
          .replace(/^Projects\/[^/]+\//, '')
          .replace(/\/[^/]+$/, '');
        return (
          <li
            key={attachment.id}
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
          >
            <Paperclip className="size-3.5 text-muted-foreground" />
            <span dir="auto" className="max-w-56 truncate" title={attachment.vaultPath}>
              {attachment.filename}
            </span>
            <span className="text-muted-foreground">{size(attachment.size)}</span>
            {projectKey && (
              <Link
                href={`${filesPath(projectKey)}?path=${encodeURIComponent(folder)}`}
                title={t('openInFiles')}
                aria-label={t('openInFiles')}
                className="text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="size-3.5" />
              </Link>
            )}
            <a
              href={mailAttachmentUrl(attachment.id)}
              title={t('download')}
              aria-label={t('download')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3.5" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
