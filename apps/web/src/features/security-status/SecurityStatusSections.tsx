'use client';

import { useTranslations } from 'next-intl';
import SettingsSection from '@/components/common/page/SettingsSection';
import SecurityAuditPanel from './components/SecurityAuditPanel';
import OwnerFactorsCard from './components/OwnerFactorsCard';
import EdgeAccessForm from './components/EdgeAccessForm';
import SignInEventsList from './components/SignInEventsList';
import { useEdgeAccessQuery, useSecurityStatusQuery } from './services/security.service';

// The server's security in four sections: the host audit, the owner's sign-in, the access
// from outside, and the password-less sign-ins. Administrator → Sicherheit shows them under
// the terminal settings; the Server area can mount this component as its "Sicherheit" tab.
export default function SecurityStatusSections() {
  const t = useTranslations('serverSecurity');
  const status = useSecurityStatusQuery();
  const edge = useEdgeAccessQuery();

  return (
    <>
      <SettingsSection title={t('auditTitle')} description={t('auditDescription')}>
        <SecurityAuditPanel audit={status.data?.audit} isPending={status.isPending} />
      </SettingsSection>
      {status.data && (
        <SettingsSection title={t('ownerTitle')} description={t('ownerDescription')}>
          <OwnerFactorsCard owner={status.data.owner} />
        </SettingsSection>
      )}
      <SettingsSection title={t('edgeTitle')} description={t('edgeDescription')}>
        {edge.data && <EdgeAccessForm key={edge.data.updatedAt ?? 'new'} settings={edge.data} />}
      </SettingsSection>
      <SettingsSection title={t('signIns.title')} description={t('signIns.description')}>
        <SignInEventsList />
      </SettingsSection>
    </>
  );
}
