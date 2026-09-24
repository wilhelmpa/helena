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
  const input = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed && !trimmed.includes('/')) onSubmit(trimmed);
  };

  return (
    <Modal
      title={title}
      description={hint}
      onClose={onClose}
      // The name without its extension is what is usually changed, so only that is
      // selected. The dialog's own opening focus would select the whole field.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const field = input.current;
        if (!field) return;
        field.focus();
        const dot = field.value.lastIndexOf('.');
        field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      }}
    >
      <form onSubmit={submit} className="space-y-4">
        <Input
          ref={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('name')}
          dir="auto"
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
