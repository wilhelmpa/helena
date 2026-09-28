'use client';

import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsToolbar from './components/SettingsToolbar';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsSubtaskAutomation from './components/configuration/SettingsSubtaskAutomation';
import SettingsEstimates from './components/configuration/SettingsEstimates';
import SettingsAutoArchive from './components/configuration/SettingsAutoArchive';
import { useAutoArchiveForm } from './hooks/useAutoArchiveForm';
import { useEstimatesForm } from './hooks/useEstimatesForm';
import { useSubtaskAutomationForm } from './hooks/useSubtaskAutomationForm';

const section = settingsSection('configuration');

// The Configuration settings page (/project/:projectKey/settings/configuration).
// Holds the subtask automations, the estimate kinds and the auto-archive
// thresholds; the Save in the page header writes all of them.
export default function SettingsConfigurationPage() {
  const { project } = useShell();
  if (!project) return null;
  return <ConfigurationPage project={project} />;
}

function ConfigurationPage({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.configuration');
  const tCommon = useTranslations('common');
  const sectionText = useSettingsSectionText()(section.slug);
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const subtasks = useSubtaskAutomationForm(project.project.key);
  const estimates = useEstimatesForm(project.project);
  const archive = useAutoArchiveForm(project.project.key);
  const saving = subtasks.saving || estimates.saving || archive.saving;
  const loaded = subtasks.loaded && archive.loaded;

  async function save() {
    await subtasks.save();
    await estimates.save();
    await archive.save();
    toast.success(t('saved'));
  }

  return (
    <SectionPageView title={sectionText.label}>
      <SettingsToolbar
        primary={
          can(section.resource, 'edit')
            ? {
                id: 'save',
                label: tCommon('save'),
                icon: Check,
                disabled: saving || !loaded,
                onClick: () => void save(),
              }
            : undefined
        }
      />
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <div className="space-y-6">
            {features.subtasks && <SettingsSubtaskAutomation form={subtasks} />}
            <SettingsEstimates form={estimates} />
            <SettingsAutoArchive form={archive} />
          </div>
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
