'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ChatRenameDialog({
  initialTitle,
  onClose,
  onConfirm,
}: {
  initialTitle: string;
  onClose: () => void;
  onConfirm: (title: string) => Promise<unknown>;
}) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const trimmed = title.trim();

  async function submit() {
    if (!trimmed) return;
    setBusy(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('list.rename')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          autoFocus
          dir="auto"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={80}
          aria-label={t('list.rename')}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !trimmed}>
            {tCommon('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
