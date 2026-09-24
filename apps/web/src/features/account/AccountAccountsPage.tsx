'use client';

import { useTranslations } from 'next-intl';
import { useTelegramAccountQuery } from '@/services/telegram.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import AccountGoogleConnection from './components/accounts/AccountGoogleConnection';
import AccountTelegramConnection from './components/accounts/AccountTelegramConnection';
import { useGoogleAvailable } from './services/accounts.service';

// A provider is only listed when the instance has it configured, so the page never
// offers a connection that cannot complete. Telegram makes that check itself; with
// neither set up the card says so instead of standing empty.
export default function AccountAccountsPage() {
  const t = useTranslations('account.accounts');
  const googleAvailable = useGoogleAvailable();
  const telegram = useTelegramAccountQuery();
  const telegramAvailable = !telegram.data || !!telegram.data.botUsername;

  return (
    <SectionPageView title={t('title')} description={t('description')}>
      <SettingsCard className="divide-y">
        {googleAvailable && <AccountGoogleConnection />}
        <AccountTelegramConnection />
        {!googleAvailable && !telegramAvailable && (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('noneAvailable')}</p>
        )}
      </SettingsCard>
    </SectionPageView>
  );
}
