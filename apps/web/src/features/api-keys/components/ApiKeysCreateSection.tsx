'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import ApiKeysCreateDialog from './ApiKeysCreateDialog';

// The page's one action, "Create API key", in the header's toolbar row, and the dialog
// it opens.
export default function ApiKeysCreateSection({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('apiKeys');
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageToolbar>
        <PageToolbarSpacer />
        <PageActions
          primary={{ id: 'create', label: t('create'), icon: Plus, onClick: () => setOpen(true) }}
        />
      </PageToolbar>

      {open && <ApiKeysCreateDialog onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}
