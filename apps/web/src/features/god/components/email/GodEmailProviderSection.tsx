import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import type { NotificationEncryption } from '@/lib/api/endpoints/notificationSettings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SettingsSection from '@/components/common/page/SettingsSection';
import SettingsCard from '@/components/common/page/SettingsCard';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import ProviderToggle from '@/components/common/inputs/ProviderToggle';
import SecretInput from '@/components/common/inputs/SecretInput';
import type { GodEmailForm } from '../../hooks/useGodEmailForm';
import GodEmailTestButton from './GodEmailTestButton';

import { Stack, Text } from '@/design-system';

const ENCRYPTION_OPTIONS: NotificationEncryption[] = ['none', 'ssl', 'tls'];

export default function GodEmailProviderSection({ form }: { form: GodEmailForm }) {
  const t = useTranslations('god.email');
  const appName = useDisplayName();
  const { settings } = form;

  return (
    <SettingsSection
      title={t('provider')}
      description={t('providerHint')}
      action={
        <EnabledSwitch checked={form.enabled} onChange={form.setEnabled} disabled={form.saving} />
      }
    >
      <SettingsCard>
        <Stack gap={4} pad={4}>
          <ProviderToggle
            value={form.provider}
            onChange={form.setProvider}
            disabled={form.saving}
          />

          <Stack gap={2} className="sm:max-w-md">
            <Label htmlFor="email-from">{t('from')}</Label>
            <Input
              id="email-from"
              value={form.from}
              onChange={(e) => form.setFrom(e.target.value)}
              placeholder={`${appName} <noreply@example.com>`}
            />
            <Text as="p" size="xs" tone="muted">
              {t('fromHint')}
            </Text>
          </Stack>

          {form.provider === 'smtp' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stack gap={2}>
                <Label htmlFor="smtp-host">{t('host')}</Label>
                <Input
                  id="smtp-host"
                  value={form.host}
                  onChange={(e) => form.setHost(e.target.value)}
                  placeholder="smtp.example.com"
                />
              </Stack>
              <Stack gap={2}>
                <Label htmlFor="smtp-port">{t('port')}</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  min={1}
                  value={form.port}
                  onChange={(e) => form.setPort(e.target.value)}
                  placeholder="587"
                />
              </Stack>
              <Stack gap={2}>
                <Label htmlFor="smtp-encryption">{t('encryption')}</Label>
                <Select
                  value={form.encryption}
                  onValueChange={(v) => form.setEncryption(v as NotificationEncryption)}
                >
                  <SelectTrigger id="smtp-encryption" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENCRYPTION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(`encryptionOptions.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Stack>
              <Stack gap={2}>
                <Label htmlFor="smtp-username">{t('username')}</Label>
                <Input
                  id="smtp-username"
                  value={form.username}
                  onChange={(e) => form.setUsername(e.target.value)}
                  placeholder="noreply@example.com"
                  autoComplete="off"
                />
              </Stack>
              <Stack gap={2}>
                <Label htmlFor="smtp-password">{t('password')}</Label>
                <SecretInput
                  id="smtp-password"
                  value={form.password}
                  onChange={form.setPassword}
                  hasStored={settings.smtp.hasPassword}
                  placeholder={t('passwordPlaceholder')}
                />
              </Stack>
              <Stack gap={2}>
                <Label htmlFor="smtp-timeout">{t('timeout')}</Label>
                <Input
                  id="smtp-timeout"
                  type="number"
                  min={1}
                  value={form.timeout}
                  onChange={(e) => form.setTimeout(e.target.value)}
                  placeholder={t('optional')}
                />
              </Stack>
            </div>
          ) : (
            <Stack gap={2} className="sm:max-w-md">
              <Label htmlFor="resend-api-key">{t('apiKey')}</Label>
              <SecretInput
                id="resend-api-key"
                value={form.apiKey}
                onChange={form.setApiKey}
                hasStored={settings.resend.hasApiKey}
                placeholder="re_…"
              />
            </Stack>
          )}

          <GodEmailTestButton form={form} />
        </Stack>
      </SettingsCard>
    </SettingsSection>
  );
}
