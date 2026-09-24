'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { useHydrated } from '@/components/common/page/useHydrated';
import { qk } from '@/services/queryKeys';
import SectionPageView from '@/components/common/page/SectionPageView';
import { usePasskeysQuery, type PasskeyRow } from './services/passkeys.service';
import AccountSection from './components/AccountSection';
import AccountSecurityPasswordForm from './components/security/AccountSecurityPasswordForm';
import AccountSecurityAddPasskey from './components/security/AccountSecurityAddPasskey';
import AccountSecurityPasskeyList from './components/security/AccountSecurityPasskeyList';
import AccountSecurityDeletePasskeyDialog from './components/security/AccountSecurityDeletePasskeyDialog';
import AccountSecurityTotpSection from './components/security/AccountSecurityTotpSection';

// How the account is signed in to: the password and the passkeys registered for it.
// Owns the passkey list query and the delete target; the child components refresh
// the list through the callbacks after a change.
export default function AccountSecurityPage() {
  const t = useTranslations('account.security');
  const { data: session } = useSession();
  // The session is in the store on hydration but not on the server: read it after.
  const email = (useHydrated() && session?.user.email) || '…';
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<PasskeyRow | null>(null);

  const { data: passkeys, isPending } = usePasskeysQuery();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.passkeys });

  return (
    <SectionPageView title={t('title')}>
      <div className="space-y-6">
        <AccountSection title={t('passwordTitle')} description={t('passwordDescription')}>
          <AccountSecurityPasswordForm />
        </AccountSection>

        <AccountSection
          title={t('passkeysTitle')}
          description={t('passkeysDescription')}
          actions={<AccountSecurityAddPasskey onAdded={invalidate} />}
          flush
        >
          <AccountSecurityPasskeyList
            passkeys={passkeys ?? []}
            isPending={isPending}
            onDelete={setDeleting}
          />
        </AccountSection>

        <AccountSection title={t('totpTitle')} description={t('totpDescription')}>
          <AccountSecurityTotpSection />
        </AccountSection>
      </div>

      {deleting && (
        <AccountSecurityDeletePasskeyDialog
          passkey={deleting}
          accountEmail={session?.user.email}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await invalidate();
          }}
        />
      )}
    </SectionPageView>
  );
}
