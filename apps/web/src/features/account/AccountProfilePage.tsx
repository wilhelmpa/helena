'use client';

import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import AccountProfileAvatar from './components/profile/AccountProfileAvatar';
import AccountProfileDetailsForm from './components/profile/AccountProfileDetailsForm';
import AccountSection from './components/AccountSection';

export default function AccountProfilePage() {
  const t = useTranslations('account.profile');

  return (
    <SectionPageView title={t('title')}>
      <div className="space-y-6">
        <AccountSection title={t('avatarTitle')} description={t('avatarDescription')}>
          <AccountProfileAvatar />
        </AccountSection>
        <AccountSection title={t('detailsTitle')} description={t('detailsDescription')}>
          <AccountProfileDetailsForm />
        </AccountSection>
      </div>
    </SectionPageView>
  );
}
