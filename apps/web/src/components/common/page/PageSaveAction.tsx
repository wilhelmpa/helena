'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';

// The Save of a settings page that collects its changes before saving (the
// Administrator's forms, a team's name): the page's one filled button, at the end of
// the header's toolbar row like every other page's primary action. "Saving…" while the
// request runs.
export default function PageSaveAction({
  onSave,
  disabled = false,
  saving = false,
  label,
}: {
  onSave: () => void;
  disabled?: boolean;
  saving?: boolean;
  // Defaults to "Save".
  label?: string;
}) {
  const t = useTranslations('common');
  return (
    <PageToolbar>
      <PageToolbarSpacer />
      <PageActions
        primary={{
          id: 'save',
          label: saving ? t('saving') : (label ?? t('save')),
          icon: Check,
          onClick: onSave,
          disabled: disabled || saving,
        }}
      />
    </PageToolbar>
  );
}
