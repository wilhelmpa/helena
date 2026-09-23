import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// The most the API accepts for one file.
const MAX_MEMORY_CHARS = 16384;

export default function AgentMemoryEditDialog({
  file,
  content,
  onSave,
  onClose,
}: {
  file: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const tCommon = useTranslations('common');
  const [value, setValue] = useState(content);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onSave(value);
    } catch {
      // Toasted by the global mutation handler; the dialog stays open for a retry.
      setBusy(false);
    }
  }

  return (
    <Modal title={t('memoryEditTitle', { file })} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('memoryEditHint')}</p>
        <Textarea
          rows={14}
          value={value}
          maxLength={MAX_MEMORY_CHARS}
          aria-label={file}
          dir="auto"
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('memorySize', { chars: value.length })}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={busy || value === content}>
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
