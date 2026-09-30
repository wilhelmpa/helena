'use client';

import { Pill } from '@/design-system';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderOpen, Paperclip, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailDraft } from '@/lib/api/endpoints/mail';
import { useDraftFile, useSaveDraft } from '../services/drafts.service';
import VaultFilePicker from './VaultFilePicker';

// The files the mail carries: uploaded here, picked from the vault, or taken over from
// the forwarded message.
export default function ComposeAttachments({
  draft,
  editable,
}: {
  draft: MailDraft;
  editable: boolean;
}) {
  const t = useTranslations('mail.compose');
  const inputRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const file = useDraftFile(draft.id);
  const save = useSaveDraft(draft.id);

  const remove = (ref: string) =>
    save.mutate({
      attachments: draft.attachments
        .filter((item) => item.ref !== ref)
        .map(({ source, ref: kept }) => ({ source, ref: kept })),
    });

  return (
    <div className="flex flex-col gap-2">
      {draft.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {draft.attachments.map((item) => (
            <li key={item.ref}>
              <Pill icon={<Paperclip />}>
                <span dir="auto" className="max-w-48 truncate" title={item.filename}>
                  {item.filename}
                </span>
                {editable && (
                  <button
                    type="button"
                    aria-label={t('removeAttachment', { name: item.filename })}
                    onClick={() => remove(item.ref)}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Pill>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={file.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            {t('upload')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
            <FolderOpen />
            {t('fromVault')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={async (event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              for (const item of files) await file.mutateAsync({ file: item });
            }}
          />
        </div>
      )}
      {picking && (
        <VaultFilePicker
          teamId={draft.teamId}
          onClose={() => setPicking(false)}
          onPick={(vaultPath) => file.mutate({ vaultPath }, { onSuccess: () => setPicking(false) })}
        />
      )}
    </div>
  );
}
