import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Inline } from '@/design-system';

export function SettingsInlineEditForm({
  name,
  onNameChange,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  leading,
  trailing,
}: {
  name: string;
  onNameChange: (v: string) => void;
  placeholder: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const t = useTranslations('common');

  return (
    <Inline gap={2} padX={3} padY={2} className="flex items-center">
      {leading}
      <Input
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
        className="h-7"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {trailing}
      <Button variant="ghost" size="sm" className="h-7" disabled={!name.trim()} onClick={onSubmit}>
        {submitLabel}
      </Button>
      <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </Inline>
  );
}
