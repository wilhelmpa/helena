'use client';

import { useTranslations } from 'next-intl';
import type { LimitAccount } from '@/lib/api/endpoints/providerLimits';
import { KNOWN_LOGINS, KNOWN_PROVIDERS } from '../utils/limitsFormat';

// What an account is called: the plan's provider ("ChatGPT", "Claude"), its plan and the
// login the numbers were read through.
export function useAccountName() {
  const t = useTranslations('providerLimits');
  return {
    provider: (account: Pick<LimitAccount, 'provider'>) =>
      KNOWN_PROVIDERS.has(account.provider)
        ? t(`providers.${account.provider}` as 'providers.anthropic')
        : account.provider,
    plan: (account: Pick<LimitAccount, 'plan'>) =>
      account.plan ? account.plan.charAt(0).toUpperCase() + account.plan.slice(1) : null,
    login: (account: Pick<LimitAccount, 'login'>) =>
      account.login && KNOWN_LOGINS.has(account.login)
        ? t(`logins.${account.login}` as 'logins.owner')
        : account.login,
  };
}
