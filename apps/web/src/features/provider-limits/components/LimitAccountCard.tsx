'use client';

import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS } from '@/components/common/page/RowList';
import type { LimitAccount } from '@/lib/api/endpoints/providerLimits';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';
import { useAccountName } from '../hooks/useAccountName';
import {
  STATE_STATUS,
  STATE_TEXT_CLASS,
  formatCountdown,
  orderedWindows,
} from '../utils/limitsFormat';
import LimitWindowRow from './LimitWindowRow';

export const LIMITS_ADMIN_HREF = '/god/agent-runtime#limits';

// One subscription account in the sidebar's surface: a 32px header row (provider, plan,
// login, state) that opens the details in the Administrator, one line per window, and a
// footer with when the numbers were read and when a limit ends.
export default function LimitAccountCard({ account, now }: { account: LimitAccount; now: number }) {
  const t = useTranslations('providerLimits');
  const name = useAccountName();
  const plan = name.plan(account);
  const login = name.login(account);
  const windows = orderedWindows(account.windows);
  const resetAt = account.nextResetAt ? Date.parse(account.nextResetAt) : null;
  return (
    <div className="flex min-w-0 flex-col gap-px rounded-lg border border-sidebar-border bg-card p-1">
      <Link href={LIMITS_ADMIN_HREF} className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}>
        <Gauge />
        <span className="min-w-0 shrink truncate font-medium">{name.provider(account)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
          {[plan, login].filter(Boolean).join(' · ')}
        </span>
        <StatusBadge status={STATE_STATUS[account.state]}>
          {t(`state.${account.state}`)}
        </StatusBadge>
      </Link>
      {account.unavailable ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {t(`unavailable.${account.unavailable}` as 'unavailable.failed')}
        </p>
      ) : windows.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('noWindows')}</p>
      ) : (
        windows.map((window) => <LimitWindowRow key={window.id} window={window} now={now} />)
      )}
      <p className="mt-auto flex min-w-0 flex-wrap items-center gap-x-2 px-2 pt-0.5 pb-1 text-xs text-muted-foreground">
        <span className={cn(account.stale && 'text-status-waiting')}>
          {t(account.stale ? 'staleSince' : 'readAgo', {
            time: formatDurationShort(account.observedAt),
          })}
        </span>
        {resetAt !== null && resetAt > now && account.state !== 'ok' && (
          <span className={STATE_TEXT_CLASS[account.state]}>
            {t(account.state === 'limited' ? 'freeIn' : 'nearUntil', {
              time: formatCountdown(resetAt - now),
            })}
          </span>
        )}
        {!!account.resetCredits && (
          <span>{t('resetCredits', { count: account.resetCredits })}</span>
        )}
      </p>
    </div>
  );
}
