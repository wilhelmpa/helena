'use client';

import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { EnvironmentVariableList } from '@/features/access/EnvironmentVariableList';
import SettingsToolbar from './components/SettingsToolbar';
import { SettingsResourceProvider } from './context/settingsPermission';

const section = settingsSection('environment');

// The environment variables the project's agents receive in their runs
// (/project/:projectKey/settings/environment): names and where they come from. They are
// managed and granted in Zugänge, so the page only shows them.
export default function SettingsEnvironmentPage() {
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  if (!project) return null;
  return (
    <SectionPageView title={sectionText.label}>
      <SettingsToolbar />
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <EnvironmentVariableList
            teamId={project.project.teamId}
            target={{ projectId: project.project.id }}
          />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
