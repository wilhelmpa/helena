'use client';

import { useTranslations } from 'next-intl';
import { Gauge, LoaderCircle, RefreshCw } from 'lucide-react';
import { RowEmpty } from '@/components/common/page/RowList';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import LimitAccountCard from '@/features/provider-limits/components/LimitAccountCard';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import {
  useProviderLimits,
  useRefreshProviderLimits,
} from '@/features/provider-limits/services/providerLimits.service';
import { orderedAccounts } from '@/features/provider-limits/utils/limitsFormat';
import { SkeletonRows } from '../DashboardCard';

// The plan limits of every subscription (provider-limits): one block per account, the ones
// near or at their limit first, divided by a hairline inside the card.
export default function LimitsBody({ columns = false }: { columns?: boolean }) {
  const t = useTranslations('providerLimits');
  const limits = useProviderLimits(true);
  const now = useNow();
  if (!limits.data || now === null) return <SkeletonRows count={4} />;
  const accounts = orderedAccounts(limits.data.accounts);
  if (accounts.length === 0) return <RowEmpty icon={<Gauge />}>{t('empty')}</RowEmpty>;
  return (
    <div
      className={cn(
        'grid min-w-0 gap-px',
        columns && 'grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-x-4',
      )}
    >
      {accounts.map((account, index) => (
        <div
          key={account.id}
          className={cn(index > 0 && !columns && 'mt-1 border-t border-sidebar-border pt-1')}
        >
          <LimitAccountCard account={account} now={now} framed={false} />
        </div>
      ))}
    </div>
  );
}

// The header button that asks every runner for fresh numbers.
export function LimitsRefresh() {
  const t = useTranslations('providerLimits');
  const refresh = useRefreshProviderLimits();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-6"
      aria-label={t('refresh')}
      title={t('refresh')}
      disabled={refresh.isPending}
      onClick={() => refresh.mutate()}
    >
      {refresh.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
    </Button>
  );
}
