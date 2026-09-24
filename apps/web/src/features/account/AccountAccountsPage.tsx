'use client';

import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import AccountGoogleConnection from './components/accounts/AccountGoogleConnection';
import AccountTelegramConnection from './components/accounts/AccountTelegramConnection';
import { useGoogleAvailable } from './services/accounts.service';

// A provider is only listed when the instance has it configured, so the page never
// offers a connection that cannot complete. Telegram makes that check itself.
export default function AccountAccountsPage() {
  const t = useTranslations('account.accounts');
  const googleAvailable = useGoogleAvailable();

  return (
    <SectionPageView title={t('title')} description={t('description')}>
      <SettingsCard className="divide-y">
        {googleAvailable && <AccountGoogleConnection />}
        <AccountTelegramConnection />
      </SettingsCard>
    </SectionPageView>
  );
}
