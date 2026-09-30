'use client';

import { useTranslations } from 'next-intl';
import { PenLine } from 'lucide-react';
import type { MailThread } from '@/lib/api/endpoints/mail';
import { useOpenCompose } from '@/hooks/useMailCompose';
import { Inline, PillButton } from '@/design-system';

// The drafts written for this thread, by the owner or an agent; one opens in the
// compose panel.
export default function MailDraftChips({ drafts }: { drafts: MailThread['drafts'] }) {
  const t = useTranslations('mail.thread');
  const openCompose = useOpenCompose();
  if (drafts.length === 0) return null;
  return (
    <Inline gap={2} marginTop={3} wrap align="stretch">
      {drafts.map((draft) => (
        <PillButton key={draft.id} onClick={() => openCompose(draft.id)} icon={<PenLine />}>
          {t(`draftStatus.${draft.status}`, { name: draft.createdByName ?? '' })}
        </PillButton>
      ))}
    </Inline>
  );
}
