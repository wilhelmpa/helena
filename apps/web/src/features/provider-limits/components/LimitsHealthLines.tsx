'use client';

import { useTranslations } from 'next-intl';
import { formatDurationShort } from '@/utils/dates';
import { useAccountName } from '../hooks/useAccountName';
import { useNow } from '../hooks/useNow';
import { useProviderLimits } from '../services/providerLimits.service';
import { formatCountdown } from '../utils/limitsFormat';

// The health overview's lines about the plan limits: an account at its limit, and numbers
// the runners stopped delivering. Nothing when all is well.
export default function LimitsHealthLines() {
  const t = useTranslations('providerLimits.health');
  const name = useAccountName();
  const limits = useProviderLimits(true);
  const now = useNow();
  if (!limits.data || now === null) return null;
  const lines = limits.data.accounts.flatMap((account) => {
    const provider = name.provider(account);
    const found: string[] = [];
    if (account.state === 'limited') {
      const reset = account.nextResetAt ? Date.parse(account.nextResetAt) : null;
      found.push(
        reset && reset > now
          ? t('limitedUntil', { provider, time: formatCountdown(reset - now) })
          : t('limited', { provider }),
      );
    }
    if (account.stale) {
      found.push(t('stale', { provider, time: formatDurationShort(account.observedAt) }));
    }
    return found.map((text) => ({ key: `${account.id}:${text}`, text }));
  });
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
      {lines.map((line) => (
        <li key={line.key}>{line.text}</li>
      ))}
    </ul>
  );
}
