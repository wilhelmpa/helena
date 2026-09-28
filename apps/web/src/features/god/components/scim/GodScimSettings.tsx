'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { InstanceScimSettings } from '@/lib/api/endpoints/scim';
import SettingsSection from '@/components/common/page/SettingsSection';
import SettingsCard from '@/components/common/page/SettingsCard';
import CopyableValue from '@/components/common/page/CopyableValue';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import { Button } from '@/components/ui/button';
import GodScimTokenDialog from './GodScimTokenDialog';
import GodScimGroupList from './GodScimGroupList';
import { useUpdateInstanceScimSettings } from '../../services/god.service';

import { Stack, Inline, Text } from '@/design-system';

// The endpoint and the token go into the identity provider; the groups it then
// pushes appear below, where the owner says what each one grants.
export default function GodScimSettings({ settings }: { settings: InstanceScimSettings }) {
  const t = useTranslations('god.scim');
  const update = useUpdateInstanceScimSettings();
  const [generating, setGenerating] = useState(false);

  async function toggle(enabled: boolean) {
    try {
      await update.mutateAsync({ enabled });
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <Stack gap={5}>
      <SettingsSection
        title={t('provisioning')}
        description={t(settings.hasToken ? 'provisioningConfigured' : 'provisioningMissing')}
        action={
          <EnabledSwitch
            checked={settings.enabled}
            onChange={(v) => void toggle(v)}
            disabled={update.isPending || !settings.hasToken}
          />
        }
      >
        <SettingsCard>
          <Stack gap={4} pad={4}>
            <Inline
              gap={4}
              align="start"
              justify="between"
              className="flex items-start justify-between"
            >
              <Stack gap={1} className="min-w-0">
                <div className="text-sm font-medium">{t('token')}</div>
                <Text as="p" size="xs" className="font-mono">
                  {settings.hasToken ? `${settings.tokenPrefix}…` : t('noToken')}
                </Text>
                <Text as="p" size="xs" tone="muted">
                  {t('tokenHint')}
                </Text>
              </Stack>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setGenerating(true)}
              >
                {settings.hasToken ? t('replaceToken') : t('generateToken')}
              </Button>
            </Inline>

            <CopyableValue
              title={t('baseUrl')}
              value={settings.baseUrl}
              hint={t('baseUrlHint')}
              copyLabel={t('copyBaseUrl')}
            />
          </Stack>
        </SettingsCard>
      </SettingsSection>

      <GodScimGroupList />

      {generating && <GodScimTokenDialog onClose={() => setGenerating(false)} />}
    </Stack>
  );
}
