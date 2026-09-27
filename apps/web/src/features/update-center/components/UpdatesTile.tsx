'use client';

import { useNow } from '@/features/provider-limits/hooks/useNow';
import { useTranslations } from 'next-intl';
import { FigureTile } from '@/features/home/dashboard/DashboardParts';
import { useUpdateCenter } from '../services/updateCenter.service';
import { headlineUpdate } from '../utils/updateFormat';

export const UPDATES_ADMIN_HREF = '/god/server/updates';

// Start → the "Updates" tile (owner, 2026-09-24: "den Status auch im Dashboard anzeigen"):
// shows pending updates or the latest automatic result and opens Administrator → Updates.
export default function UpdatesTile() {
  const t = useTranslations('updates');
  const tHome = useTranslations('home');
  const center = useUpdateCenter(true).data;
  const now = useNow(60_000);
  if (!center) return null;
  const security = center.counts.security;
  const headline = headlineUpdate(center.items);
  const latestAction = center.actions[0];
  const latest =
    latestAction?.automatic &&
    latestAction.state !== 'running' &&
    (latestAction.state === 'failed' ||
      (now !== null && now - Date.parse(latestAction.finishedAt ?? '') < 24 * 60 * 60_000))
      ? latestAction
      : null;
  if (center.counts.updates === 0 && !latest) return null;
  const rolledBack =
    latest?.state === 'failed' && latest.error?.includes('previous version restored');
  return (
    <FigureTile
      href={UPDATES_ADMIN_HREF}
      label={tHome('widgets.updates')}
      value={center.counts.updates}
      status={latest?.state === 'failed' || security > 0 ? 'danger' : 'waiting'}
      subTone={latest?.state === 'failed' || security > 0 ? 'danger' : 'default'}
      sub={
        latest?.state === 'failed'
          ? `${rolledBack ? t('autoRolledBack') : t('autoFailedShort')}: ${latest.error ?? latest.name}`
          : latest?.state === 'done'
            ? t('autoApplied', { name: latest.name })
            : security > 0
              ? t('securityCount', { count: security })
              : (headline?.name ?? '')
      }
    />
  );
}
