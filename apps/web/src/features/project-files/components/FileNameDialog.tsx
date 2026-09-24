import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Asks for one name: a new folder, a new note, or the new name of an entry.
export default function FileNameDialog({
  title,
  hint,
  initialName,
  submitLabel,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  hint?: string;
  initialName: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('files.dialog');
  const [name, setName] = useState(initialName);
  // The name is preselected once, when the dialog opens; a later click places the caret.
  const preselected = useRef(false);
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed && !trimmed.includes('/')) onSubmit(trimmed);
  };

  return (
    <Modal title={title} description={hint} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('name')}
          dir="auto"
          onFocus={(event) => {
            // The name without its extension is what is usually changed. The dialog
            // selects the whole field right after focusing it, so the range is set
            // once that has happened.
            const input = event.target;
            if (preselected.current) return;
            preselected.current = true;
            requestAnimationFrame(() => {
              const dot = input.value.lastIndexOf('.');
              input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
            });
          }}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!trimmed || trimmed.includes('/') || pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
