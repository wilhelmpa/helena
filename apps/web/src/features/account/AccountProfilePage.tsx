'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useHydrated } from '@/components/common/page/useHydrated';
import SectionPageView from '@/components/common/page/SectionPageView';
import AccountProfileAvatar from './components/profile/AccountProfileAvatar';
import AccountProfileDetailsForm from './components/profile/AccountProfileDetailsForm';
import AccountSection from './components/AccountSection';

export default function AccountProfilePage() {
  const t = useTranslations('account.profile');
  const { data: session } = useSession();
  // The session is in the store on hydration but not on the server: read it after.
  const email = (useHydrated() && session?.user.email) || '…';

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
