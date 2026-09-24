'use client';

import Link from 'next/link';
import { CircleCheck, LoaderCircle, PackageCheck, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  ROW_CLASS,
  ROW_INTERACTIVE_CLASS,
  RowList,
  SectionLabel,
} from '@/components/common/page/RowList';
import { useHydrated } from '@/components/common/page/useHydrated';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';
import { useCheckForUpdates, useUpdateCenter } from '../services/updateCenter.service';
import { headlineUpdate, justNow, versionStep } from '../utils/updateFormat';
import { UpdateBadges, UpdateSummary } from './UpdateCard';

export const UPDATES_ADMIN_HREF = '/god/server/updates';

// Start → "Updates" (owner, 2026-09-24: "den Status auch im Dashboard anzeigen"): how many
// updates there are and how many fix a vulnerability, and the most important one (security
// first, then the highest risk) with what it changes. For the Administrator; the label's
// button checks now, every row opens Administrator → Updates.
export default function HomeUpdates() {
  const t = useTranslations('updates');
  const { data: session } = useSession();
  const isGod = useHydrated() && session?.user.role === 'god';
  const query = useUpdateCenter(isGod);
  const check = useCheckForUpdates();
  const center = query.data;
  if (!isGod || !center) return null;
  const headline = headlineUpdate(center.items);
  const checking = check.isPending || center.job.lastStatus === 'running';

  return (
    <section className="min-w-0">
      <SectionLabel
        icon={<PackageCheck />}
        trailing={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('check')}
            title={t('check')}
            disabled={checking}
            onClick={() => check.mutate()}
          >
            {checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          </Button>
        }
      >
        {t('title')}
      </SectionLabel>
      <RowList className="bg-card">
        <Link href={UPDATES_ADMIN_HREF} className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}>
          {headline ? <PackageCheck /> : <CircleCheck className="!text-status-success" />}
          <span className="min-w-0 shrink truncate font-medium">
            {center.counts.updates === 0
              ? t('home.empty')
              : t('count', { count: center.counts.updates })}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {center.counts.security > 0
              ? t('securityCount', { count: center.counts.security })
              : center.checkedAt
                ? justNow(center.checkedAt)
                  ? t('checkedJustNow')
                  : t('checkedAt', { time: formatDurationShort(center.checkedAt) })
                : t('neverChecked')}
          </span>
          {center.counts.updates > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">{t('home.more')}</span>
          )}
        </Link>
        {headline && (
          <Link
            href={UPDATES_ADMIN_HREF}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 outline-none',
              ROW_INTERACTIVE_CLASS,
            )}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="min-w-0 truncate" dir="auto">
                {headline.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {versionStep(headline)}
              </span>
              <UpdateBadges item={headline} />
            </span>
            <UpdateSummary item={headline} agentId={null} compact />
          </Link>
        )}
      </RowList>
    </section>
  );
}
