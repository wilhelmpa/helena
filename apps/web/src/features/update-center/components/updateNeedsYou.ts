'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NeedsYouSourceResult } from '@/extensions/needsYouSources';
import { useUpdateCenter } from '../services/updateCenter.service';
import { UPDATES_ADMIN_HREF } from './UpdatesTile';

export function useUpdateEntries({ owner }: { owner: boolean }): NeedsYouSourceResult {
  const t = useTranslations('updates');
  const center = useUpdateCenter(owner).data;
  if (!owner) return { entries: [], isPending: false };
  const jobFailure =
    center?.job.lastStatus === 'failed' && center.job.lastError
      ? [
          {
            key: 'problem:update:check',
            kind: 'problem' as const,
            at: center.job.lastFinishedAt ?? center.job.lastStartedAt ?? '',
            href: UPDATES_ADMIN_HREF,
            icon: TriangleAlert,
            title: t('autoFailedShort'),
            detail: center.job.lastError,
          },
        ]
      : [];
  return {
    entries: [
      ...jobFailure,
      ...(center?.actions ?? [])
        .filter(
          (action) =>
            action.automatic &&
            action.state === 'failed' &&
            !center?.actions.some(
              (newer) =>
                newer.id > action.id &&
                newer.source === action.source &&
                newer.component === action.component,
            ),
        )
        .map((action) => ({
          key: `problem:update:${action.id}`,
          kind: 'problem' as const,
          at: action.finishedAt ?? action.requestedAt,
          href: UPDATES_ADMIN_HREF,
          icon: TriangleAlert,
          title: t('autoFailed', { name: action.name }),
          detail: action.error ?? '',
        })),
    ],
    isPending: false,
  };
}
