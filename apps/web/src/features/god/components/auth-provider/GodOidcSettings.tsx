import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SettingsSection from '@/components/common/page/SettingsSection';
import SettingsCard from '@/components/common/page/SettingsCard';
import CopyableValue from '@/components/common/page/CopyableValue';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import SecretInput from '@/components/common/inputs/SecretInput';
import type { GodOidcForm } from '../../hooks/useGodOidcForm';

import { Stack, Text } from '@/design-system';

// The instance's own OIDC provider: any server that publishes a well-known document
// (Keycloak, Authentik, KanIDM, GitLab, Forgejo). The authorization, token and
// userinfo endpoints are read from that document, so none of them is entered here.
export default function GodOidcSettings({ form }: { form: GodOidcForm }) {
  const t = useTranslations('god.authProvider');

  return (
    <SettingsSection
      title={t('oidc')}
      description={t(form.hasCredentials ? 'oidcConfigured' : 'oidcMissing')}
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
          <Stack gap={2}>
            <Label htmlFor="oidc-discovery-url">{t('discoveryUrl')}</Label>
            <Input
              id="oidc-discovery-url"
              value={form.discoveryUrl}
              onChange={(e) => form.setDiscoveryUrl(e.target.value)}
              placeholder="https://idp.example.com/.well-known/openid-configuration"
              autoComplete="off"
            />
            <Text as="p" size="xs" tone="muted">
              {t('discoveryUrlHint')}
            </Text>
          </Stack>

          <div className="grid gap-4 sm:grid-cols-2">
            <Stack gap={2}>
              <Label htmlFor="oidc-client-id">{t('clientId')}</Label>
              <Input
                id="oidc-client-id"
                value={form.clientId}
                onChange={(e) => form.setClientId(e.target.value)}
                autoComplete="off"
              />
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="oidc-client-secret">{t('clientSecret')}</Label>
              <SecretInput
                id="oidc-client-secret"
                value={form.clientSecret}
                onChange={form.setClientSecret}
                hasStored={form.settings.hasClientSecret}
              />
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="oidc-label">{t('oidcLabel')}</Label>
              <Input
                id="oidc-label"
                value={form.label}
                onChange={(e) => form.setLabel(e.target.value)}
                placeholder={t('oidcLabelPlaceholder')}
                maxLength={60}
              />
              <Text as="p" size="xs" tone="muted">
                {t('oidcLabelHint')}
              </Text>
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="oidc-scopes">{t('scopes')}</Label>
              <Input
                id="oidc-scopes"
                value={form.scopes}
                onChange={(e) => form.setScopes(e.target.value)}
                placeholder="openid profile email"
                autoComplete="off"
              />
              <Text as="p" size="xs" tone="muted">
                {t('scopesHint')}
              </Text>
            </Stack>
          </div>

          <CopyableValue
            title={t('redirectUri')}
            value={form.settings.redirectUri}
            hint={t('oidcRedirectUriHint')}
            copyLabel={t('copyRedirectUri')}
          />
        </Stack>
      </SettingsCard>
    </SettingsSection>
  );
}
