'use client';

import { FileText, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface PendingAttachment {
  path: string;
  name: string;
}

// The files attached to the message being composed, as small removable chips above
// the textarea — the preview the owner asked for, so a member sees what will be sent
// before sending it.
export default function ChatComposerAttachments({
  attachments,
  uploading,
  onRemove,
}: {
  attachments: PendingAttachment[];
  uploading: boolean;
  onRemove: (path: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  if (attachments.length === 0 && !uploading) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {attachments.map((attachment) => (
        <span
          key={attachment.path}
          className="flex max-w-48 items-center gap-1 rounded-md border bg-muted/50 py-1 ps-2 pe-1 text-xs"
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span dir="auto" className="truncate">
            {attachment.name}
          </span>
          <button
            type="button"
            onClick={() => onRemove(attachment.path)}
            aria-label={t('composer.removeAttachment', { name: attachment.name })}
            className="ms-0.5 grid size-4 shrink-0 place-items-center rounded-sm hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {uploading && (
        <span className="flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('composer.uploading')}
        </span>
      )}
    </div>
  );
}
