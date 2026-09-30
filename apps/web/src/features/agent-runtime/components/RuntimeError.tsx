'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Notice } from '@/design-system';
import { ApiError } from '@/lib/api/core/client';

// Why a read of the agent's runtime failed, in words: its runner is away, did not answer in
// time, or the runtime refused.
export default function RuntimeError({ error }: { error: unknown }) {
  const t = useTranslations('agentRuntime.errors');
  const status = error instanceof ApiError ? error.status : 0;
  const text =
    status === 503
      ? t('offline')
      : status === 504
        ? t('timeout')
        : status === 409
          ? t('noRuntime')
          : status === 404
            ? t('notFound')
            : error instanceof Error && error.message
              ? error.message
              : t('failed');
  return <Notice icon={<CircleAlert />}>{text}</Notice>;
}
