import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SettingsSection from '@/components/common/page/SettingsSection';
import SettingsCard from '@/components/common/page/SettingsCard';
import CopyableValue from '@/components/common/page/CopyableValue';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import SecretInput from '@/components/common/inputs/SecretInput';
import type { GodGoogleForm } from '../../hooks/useGodGoogleForm';

import { Stack } from '@/design-system';

// The Google OAuth credentials from the Google Cloud console. The
// redirect URI is derived from the API origin and shown read-only, since it has to be
// registered on the OAuth client for the round trip to work at all.
export default function GodGoogleSettings({ form }: { form: GodGoogleForm }) {
  const t = useTranslations('god.authProvider');

  return (
    <SettingsSection
      title={t('google')}
      description={t(form.hasCredentials ? 'googleConfigured' : 'googleMissing')}
      action={
        <EnabledSwitch
          checked={form.enabled}
          onChange={form.setEnabled}
          disabled={form.saving || !form.hasCredentials}
        />
      }
    >
      <SettingsCard>
        <Stack gap={4} pad={4}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Stack gap={2}>
              <Label htmlFor="google-client-id">{t('clientId')}</Label>
              <Input
                id="google-client-id"
                value={form.clientId}
                onChange={(e) => form.setClientId(e.target.value)}
                placeholder="…apps.googleusercontent.com"
                autoComplete="off"
              />
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="google-client-secret">{t('clientSecret')}</Label>
              <SecretInput
                id="google-client-secret"
                value={form.clientSecret}
                onChange={form.setClientSecret}
                hasStored={form.settings.hasClientSecret}
                placeholder="GOCSPX-…"
              />
            </Stack>
          </div>

          <CopyableValue
            title={t('redirectUri')}
            value={form.settings.redirectUri}
            hint={t('redirectUriHint')}
            copyLabel={t('copyRedirectUri')}
          />
        </Stack>
      </SettingsCard>
    </SettingsSection>
  );
}
