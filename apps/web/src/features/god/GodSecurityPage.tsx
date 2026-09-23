'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import { Button } from '@/components/ui/button';
import {
  useOwnerTerminalAuditQuery,
  useOwnerTerminalGrantQuery,
  useOwnerTerminalSettingsQuery,
  useRevokeOwnerTerminalGrant,
  useUpdateOwnerTerminalSettings,
} from '@/features/owner-terminal/services/owner-terminal.service';
import GodSectionPage from './components/GodSectionPage';
import GodSecurityAuditList from './components/security/GodSecurityAuditList';

// Home -> Security: the owner terminal's step-up policy, its current grant and
// its audit trail. See docs/volition-design-owner-terminals.md §2.
export default function GodSecurityPage() {
  const t = useTranslations('god.security');
  const settings = useOwnerTerminalSettingsQuery();
  const grant = useOwnerTerminalGrantQuery();
  const audit = useOwnerTerminalAuditQuery();
  const updateSettings = useUpdateOwnerTerminalSettings();
  const revoke = useRevokeOwnerTerminalGrant();

  return (
    <GodSectionPage slug="security">
      <SettingsSection title={t('grantTitle')} description={t('grantDescription')}>
        <SettingsCard className="space-y-2 p-4 text-sm">
          {grant.data?.active ? (
            <div className="flex items-center justify-between">
              <span>
                {t('grantActive', {
                  time: grant.data.expiresAt ? new Date(grant.data.expiresAt).toLocaleString() : '',
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                {t('grantRevoke')}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('grantInactive')}</p>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('stepUpTitle')} description={t('stepUpDescription')}>
        <SettingsCard className="p-4 text-sm text-muted-foreground">
          {t('stepUpMethod')}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('sudoTitle')}
        description={t('sudoDescription')}
        action={
          <EnabledSwitch
            checked={settings.data?.sudoPasswordRequired ?? true}
            onChange={(checked) => updateSettings.mutate({ sudoPasswordRequired: checked })}
            disabled={!settings.data || updateSettings.isPending}
          />
        }
      >
        <SettingsCard className="p-4 text-xs text-muted-foreground">{t('sudoHint')}</SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('auditTitle')} description={t('auditDescription')}>
        <GodSecurityAuditList entries={audit.data ?? []} isPending={audit.isPending} />
      </SettingsSection>
    </GodSectionPage>
  );
}
