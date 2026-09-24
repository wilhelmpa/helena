'use client';

import { useTranslations } from 'next-intl';
import { FigureTile } from '@/features/home/dashboard/DashboardParts';
import { useUpdateCenter } from '../services/updateCenter.service';
import { headlineUpdate } from '../utils/updateFormat';

export const UPDATES_ADMIN_HREF = '/god/updates';

// Start → the "Updates" tile (owner, 2026-09-24: "den Status auch im Dashboard anzeigen"):
// shown only while there are updates. How many, how many fix a vulnerability (red, first),
// else the most important one; opens Administrator → Updates. For the Administrator.
export default function UpdatesTile() {
  const t = useTranslations('updates');
  const tHome = useTranslations('home');
  const center = useUpdateCenter(true).data;
  if (!center || center.counts.updates === 0) return null;
  const security = center.counts.security;
  const headline = headlineUpdate(center.items);
  return (
    <FigureTile
      href={UPDATES_ADMIN_HREF}
      label={tHome('widgets.updates')}
      value={center.counts.updates}
      status={security > 0 ? 'danger' : 'waiting'}
      subTone={security > 0 ? 'danger' : 'default'}
      sub={security > 0 ? t('securityCount', { count: security }) : (headline?.name ?? '')}
    />
  );
}
