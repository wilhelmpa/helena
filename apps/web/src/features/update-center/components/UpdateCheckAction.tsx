'use client';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageActions } from '@/components/layout/PageToolbar';
import { useCheckForUpdates, useUpdateCenter } from '../services/updateCenter.service';

export default function UpdateCheckAction() {
  const t = useTranslations('updates');
  const query = useUpdateCenter();
  const check = useCheckForUpdates();
  const checking = check.isPending || query.data?.job.lastStatus === 'running';
  return (
    <PageActions
      primary={{
        id: 'check',
        label: checking ? t('checking') : t('check'),
        icon: checking ? LoaderCircle : RefreshCw,
        disabled: checking,
        onClick: () => check.mutate(),
      }}
    />
  );
}
