'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { APP_NAME, UPSTREAM_URL } from '@/utils/app';
import GodSectionPage from './components/GodSectionPage';
import {
  useInstanceProjectDefaultsQuery,
  useInstanceRunResumeSettingsQuery,
  useUpdateInstanceProjectDefaults,
  useUpdateInstanceRunResumeSettings,
} from './services/god.service';
import type { ProjectDefaults } from '@/lib/api/endpoints/projects';
import type { RunResumeSettings } from '@/lib/api/endpoints/god';

export default function GodGeneralPage() {
  const projectDefaults = useInstanceProjectDefaultsQuery();
  const runResume = useInstanceRunResumeSettingsQuery();

  if (!projectDefaults.data || !runResume.data) {
    return (
      <GodSectionPage slug="general">
        <ListSkeleton rows={5} rowClassName="h-12" />
      </GodSectionPage>
    );
  }
  return (
    <GeneralForm
      key={JSON.stringify(projectDefaults.data) + JSON.stringify(runResume.data)}
      defaults={projectDefaults.data}
      runResume={runResume.data}
    />
  );
}

function GeneralForm({
  defaults,
  runResume,
}: {
  defaults: ProjectDefaults;
  runResume: RunResumeSettings;
}) {
  const t = useTranslations('god.general');
  const tCommon = useTranslations('common');
  const update = useUpdateInstanceProjectDefaults();
  const updateRunResume = useUpdateInstanceRunResumeSettings();
  const [maxResumes, setMaxResumes] = useState(String(runResume.maxResumes));

  // A single toggle, so it saves on change rather than behind a Save button.
  async function setMcpEnabled(mcpEnabled: boolean) {
    try {
      await update.mutateAsync({ ...defaults, mcpEnabled });
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  const parsedMaxResumes = Number(maxResumes);
  const maxResumesValid =
    Number.isInteger(parsedMaxResumes) && parsedMaxResumes >= 0 && parsedMaxResumes <= 20;

  async function saveMaxResumes() {
    if (!maxResumesValid) return;
    try {
      await updateRunResume.mutateAsync({ maxResumes: parsedMaxResumes });
      toast.success(t('savedRunResume'));
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
      <SettingsSection title={t('runResume')}>
        <SettingsCard>
          <SettingsRow
            title={t('maxResumes')}
            description={t('maxResumesHint')}
            control={
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="w-20"
                  value={maxResumes}
                  disabled={updateRunResume.isPending}
                  onChange={(e) => setMaxResumes(e.target.value)}
                  onBlur={() => void saveMaxResumes()}
                  aria-invalid={!maxResumesValid}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !maxResumesValid ||
                    updateRunResume.isPending ||
                    parsedMaxResumes === runResume.maxResumes
                  }
                  onClick={() => void saveMaxResumes()}
                >
                  {updateRunResume.isPending ? tCommon('saving') : tCommon('save')}
                </Button>
              </div>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <AboutSection />
    </GodSectionPage>
  );
}

// The AGPL-3.0 attribution the fork's licence requires, next to the product name. No
// version: the owner wants none shown anywhere (2026-09-24). Reuses the nav menu's own
// basedOn copy and link (see messages/*/nav.json) so the wording stays in one place.
function AboutSection() {
  const t = useTranslations('god.general');
  const tNav = useTranslations('nav');

  return (
    <SettingsSection title={t('about')}>
      <SettingsCard className="space-y-1 p-4">
        <div className="text-sm font-medium">{APP_NAME}</div>
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
