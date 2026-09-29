import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProjectDefaults } from '@/lib/api/endpoints/projects';
import type { EngineSettingsAdmin, RunResumeSettings } from '@/lib/api/endpoints/god';
import { useUpdateInstanceRunResumeSettings } from '../services/god.service';
import GodEngineSettings from './GodEngineSettings';
import GodSectionPage from './GodSectionPage';
import GodProjectDefaultsSettings from './GodProjectDefaultsSettings';

import { Inline } from '@/design-system';

export default function GodGeneralForm({
  defaults,
  runResume,
  engine,
}: {
  defaults: ProjectDefaults;
  runResume: RunResumeSettings;
  engine: EngineSettingsAdmin;
}) {
  const t = useTranslations('god.general');
  const tCommon = useTranslations('common');
  const updateRunResume = useUpdateInstanceRunResumeSettings();
  const [maxResumes, setMaxResumes] = useState(String(runResume.maxResumes));

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
      <GodProjectDefaultsSettings defaults={defaults} />
      <SettingsSection title={t('runResume')}>
        <SettingsCard>
          <SettingsRow
            title={t('maxResumes')}
            description={t('maxResumesHint')}
            control={
              <Inline gap={2} className="flex items-center">
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
              </Inline>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <GodEngineSettings settings={engine} />
    </GodSectionPage>
  );
}
