'use client';

import Shell from '@/components/layout/Shell';
import { useTranslations } from 'next-intl';
import MailContent from './MailContent';

export default function MailPage() {
  const t = useTranslations('connections.mail');
  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <MailContent />
    </Shell>
  );
}
