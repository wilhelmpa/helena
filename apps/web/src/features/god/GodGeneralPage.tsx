'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Switch } from '@/components/ui/switch';
import { APP_NAME, UPSTREAM_URL } from '@/utils/app';
import { useAppVersionQuery } from '@/services/updates.service';
import GodSectionPage from './components/GodSectionPage';
import GodSettingsGate from './components/GodSettingsGate';
import {
  useInstanceProjectDefaultsQuery,
  useUpdateInstanceProjectDefaults,
} from './services/god.service';
import type { ProjectDefaults } from '@/lib/api/endpoints/projects';

export default function GodGeneralPage() {
  const query = useInstanceProjectDefaultsQuery();

  return (
    <GodSettingsGate slug="general" data={query.data}>
      {(defaults) => <GeneralForm defaults={defaults} />}
    </GodSettingsGate>
  );
}

function GeneralForm({ defaults }: { defaults: ProjectDefaults }) {
  const t = useTranslations('god.general');
  const update = useUpdateInstanceProjectDefaults();

  // A single toggle, so it saves on change rather than behind a Save button.
  async function setMcpEnabled(mcpEnabled: boolean) {
    try {
      await update.mutateAsync({ ...defaults, mcpEnabled });
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <GodSectionPage slug="general">
      <SettingsSection title={t('projectDefaults')}>
        <SettingsCard>
          <SettingsRow
            title={t('mcpEnabled')}
            description={t('mcpEnabledHint')}
            control={
              <Switch
                checked={defaults.mcpEnabled}
                disabled={update.isPending}
                onCheckedChange={(checked) => void setMcpEnabled(checked)}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
      <AboutSection />
    </GodSectionPage>
  );
}

// The AGPL-3.0 attribution the fork's licence requires, together with the running
// product name and version. Reuses the nav menu's own basedOn copy and link (see
// messages/*/nav.json) so the wording stays in one place.
function AboutSection() {
  const t = useTranslations('god.general');
  const tNav = useTranslations('nav');
  const { data: appVersion } = useAppVersionQuery();

  return (
    <SettingsSection title={t('about')}>
      <SettingsCard className="space-y-1.5">
        <div className="text-sm font-medium">
          {APP_NAME}
          {appVersion?.version ? (
            <span className="ms-2 font-mono text-xs font-normal text-muted-foreground">
              v{appVersion.version}
            </span>
          ) : null}
        </div>
        <a
          href={UPSTREAM_URL}
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {tNav('basedOn')}
        </a>
      </SettingsCard>
    </SettingsSection>
  );
}
