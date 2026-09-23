'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setComposeDraft } from '@/hooks/useMailCompose';
import { useMailDraft } from '../services/drafts.service';
import ComposeEditor from './ComposeEditor';

export default function ComposeForm({ draftId }: { draftId: number }) {
  const t = useTranslations('mail.compose');
  const draft = useMailDraft(draftId);
  if (draft.isPending) return <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>;
  if (draft.isError || !draft.data)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        {t('gone')}
        <Button type="button" size="icon-xs" variant="ghost" onClick={() => setComposeDraft(null)}>
          <X />
        </Button>
      </div>
    );
  return <ComposeEditor draft={draft.data} />;
}
