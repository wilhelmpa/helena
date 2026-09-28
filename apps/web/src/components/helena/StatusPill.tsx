'use client';

import { useTranslations } from 'next-intl';
import Orb from './Orb';
import type { HelenaStatus } from '@/utils/helenaStatus';

export default function StatusPill({
  status,
  className = '',
}: {
  status: HelenaStatus;
  className?: string;
}) {
  const t = useTranslations('common.status');
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-status={status}>
      <Orb state={status} size="dot" />
      {t(status)}
    </span>
  );
}
