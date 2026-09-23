'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import type { MailDraft } from '@/lib/api/endpoints/mail';

// What happens to the draft now, when it is not simply being written.
export default function ComposeStatus({ draft }: { draft: MailDraft }) {
  const t = useTranslations('mail.compose');
  if (draft.status === 'pending_approval')
    return (
      <p className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <ShieldCheck className="size-4" />
        {t('pendingApproval')}
      </p>
    );
  if (draft.status === 'queued' || draft.status === 'sending')
    return (
      <p className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Clock className="size-4" />
        {t('onItsWay')}
      </p>
    );
  if (draft.status === 'sent')
    return <p className="border-b bg-muted/40 px-3 py-2 text-xs">{t('sent')}</p>;
  if (draft.lastError)
    return (
      <p className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="size-4" />
        {draft.lastError}
      </p>
    );
  if (draft.createdByName && draft.createdByUserId)
    return (
      <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        {t('by', { name: draft.createdByName })}
      </p>
    );
  return null;
}
