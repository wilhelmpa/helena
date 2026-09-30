'use client';

import { Card } from '@/design-system';
import Link from 'next/link';
import { Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import { serverPath } from '@/utils/paths';
import { useServerOverview } from '../services/server.service';
import { healthStatus, orderedHealth, worstState } from '../utils/serverFormat';
import { HealthLine, useHealthMessage } from './ServerParts';

// The machine in Start's "Dienste" block: every red or amber line of the Server area (a
// degraded RAID, a failing disk, a late backup, fans the guard raised), or one quiet line
// with the mirror, the last backup and the CPU when all is well. Nothing on a host without
// the host helper.
const SUMMARY = ['raid:', 'backup:last', 'cpu:temperature', 'fans'];

export default function ServerHealthLines() {
  const t = useTranslations('server');
  const message = useHealthMessage();
  const overview = useServerOverview();
  if (!overview.data) return null;
  const items = overview.data.capabilities
    .filter((capability) => capability.available)
    .flatMap((capability) => capability.health);
  if (items.length === 0) return null;
  const problems = orderedHealth(items).filter(
    (item) => item.state === 'critical' || item.state === 'attention',
  );
  const summary = SUMMARY.flatMap((prefix) =>
    items.filter((item) => item.state === 'ok' && item.id.startsWith(prefix)).slice(0, 1),
  );
  const state = worstState(items.map((item) => item.state));

  return (
    <div className="mt-2 min-w-0">
      <Link
        href={serverPath('overview')}
        className="flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground [&>svg]:size-3.5"
      >
        <Server />
        <span className="min-w-0 flex-1 truncate">{t('home.title')}</span>
        <StatusBadge status={healthStatus(state)} dotOnly />
      </Link>
      <Card as="ul" pad="none">
        {problems.map((item) => (
          <HealthLine key={item.id} item={item} />
        ))}
        {problems.length === 0 && (
          <li className="flex min-h-8 min-w-0 items-center gap-2 px-2 py-1 text-sm">
            <StatusBadge status="success" dotOnly />
            <span className="min-w-0 flex-1 truncate">
              {summary.map((item) => message(item)).join(' · ') || t('home.allGood')}
            </span>
          </li>
        )}
      </Card>
    </div>
  );
}
