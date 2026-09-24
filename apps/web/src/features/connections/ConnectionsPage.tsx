'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import ConnectionsContent from './ConnectionsContent';

export default function ConnectionsPage() {
  const t = useTranslations('connections');
  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <ConnectionsContent />
    </Shell>
  );
}
