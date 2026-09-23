'use client';

import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import UnsavedChangesBar from '@/components/common/page/UnsavedChangesBar';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsGeneral from './components/general/SettingsGeneral';
import SettingsFeatures from './components/general/SettingsFeatures';
import SettingsSetup from './components/general/SettingsSetup';
import ProjectDangerZone from './components/general/ProjectDangerZone';
import { useGeneralForm } from './hooks/useGeneralForm';
import { useFeatureToggles } from './hooks/useFeatureToggles';

const section = settingsSection('general');

// The General settings page (/project/:projectKey/settings/general). Edits the
// project name and description; the key is shown read-only. The floating save bar
// replaces the old header Save button (docs/volition-design-helena-ui.md
// "Speicherleiste") — everything else here (the feature switches, the setup job
// retry) already saves on its own action, so only the name/description draft needs
// it. Ends in the danger zone.
export default function SettingsGeneralPage() {
  const { project } = useShell();
  if (!project) return null;
  return <GeneralPage project={project} />;
}

function GeneralPage({ project }: { project: ProjectDetail }) {
  const sectionText = useSettingsSectionText()(section.slug);
  const form = useGeneralForm(project);
  const features = useFeatureToggles(project);
  return (
    <SectionPageView title={sectionText.label} description={sectionText.description}>
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <div className="space-y-10 pb-16">
            <SettingsGeneral form={form} />
            <SettingsFeatures form={features} />
            <SettingsSetup project={project} />
            <ProjectDangerZone project={project} />
          </div>
          {form.editable && (
            <UnsavedChangesBar
              dirty={form.dirty}
              saving={form.saving}
              onSave={() => void form.save()}
              onDiscard={form.discard}
            />
          )}
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
