'use client';

import { Gauge, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RowEmpty, RowList, SectionLabel } from '@/components/common/page/RowList';
import { useHydrated } from '@/components/common/page/useHydrated';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { useNow } from '../hooks/useNow';
import { useProviderLimits, useRefreshProviderLimits } from '../services/providerLimits.service';
import { orderedAccounts } from '../utils/limitsFormat';
import LimitAccountCard from './LimitAccountCard';

// Start → "Limits" (owner, 2026-09-24: "zeige mir im Dashboard von Codex und Claude die
// Limits an"): how much of each subscription's limits is used, one box per account, for the
// Administrator. The label's button asks every runner for fresh numbers.
export default function HomeLimits() {
  const t = useTranslations('providerLimits');
  const { data: session } = useSession();
  // Read after hydration, so the server render and the first client render agree.
  const isGod = useHydrated() && session?.user.role === 'god';
  const limits = useProviderLimits(isGod);
  const refresh = useRefreshProviderLimits();
  const now = useNow();
  if (!isGod || !limits.data || now === null) return null;
  const accounts = orderedAccounts(limits.data.accounts);

  return (
    <section className="min-w-0">
      <SectionLabel
        icon={<Gauge />}
        trailing={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          </Button>
        }
      >
        {t('title')}
      </SectionLabel>
      {accounts.length === 0 ? (
        <RowList className="bg-card">
          <RowEmpty icon={<Gauge />}>{t('empty')}</RowEmpty>
        </RowList>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          {accounts.map((account) => (
            <LimitAccountCard key={account.id} account={account} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
