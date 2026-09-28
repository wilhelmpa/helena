import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Inline } from '@/design-system';

export function SettingsInlineForm({
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
    <Inline gap={3} pad={2} className="flex items-center rounded-md bg-muted/40">
      {leading}
      <Input
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 flex-1 bg-background"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {trailing}
      <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
        {t('cancel')}
      </Button>
      <Button size="sm" className="h-8" disabled={!name.trim()} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </Inline>
  );
}
