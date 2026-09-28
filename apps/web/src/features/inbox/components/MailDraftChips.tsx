'use client';

import { useTranslations } from 'next-intl';
import { PenLine } from 'lucide-react';
import type { MailThread } from '@/lib/api/endpoints/mail';
import { useOpenCompose } from '@/hooks/useMailCompose';
import { Inline } from '@/design-system';

// The drafts written for this thread, by the owner or an agent; one opens in the
// compose panel.
export default function MailDraftChips({ drafts }: { drafts: MailThread['drafts'] }) {
  const t = useTranslations('mail.thread');
  const openCompose = useOpenCompose();
  if (drafts.length === 0) return null;
  return (
    <Inline gap={2} marginTop={3} wrap align="stretch">
      {drafts.map((draft) => (
        <button
          key={draft.id}
          type="button"
          onClick={() => openCompose(draft.id)}
          className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-accent"
        >
          <PenLine className="size-3.5" />
          {t(`draftStatus.${draft.status}`, { name: draft.createdByName ?? '' })}
        </button>
      ))}
    </Inline>
  );
}
