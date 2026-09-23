import { type FormEvent, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Modal from './Modal';

// A modal that asks for one name, to create something or rename it. Submitting is off
// while the name is empty or unchanged. A failed save is toasted globally and keeps the
// dialog open so the user can retry.
export default function NameDialog({
  title,
  description,
  label,
  initialName = '',
  maxLength = 100,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initialName?: string;
  maxLength?: number;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const id = useId();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const ready = trimmed !== '' && trimmed !== initialName;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            autoFocus
            dir="auto"
            value={name}
            maxLength={maxLength}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !ready}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
