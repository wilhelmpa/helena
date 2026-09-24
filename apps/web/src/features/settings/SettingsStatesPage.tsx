'use client';

import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsToolbar from './components/SettingsToolbar';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsStates from './components/states/SettingsStates';
import StatesToolbar from './components/states/StatesToolbar';

const section = settingsSection('states');

// The States settings page (/project/:projectKey/settings/states).
export default function SettingsStatesPage() {
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  if (!project) return null;
  return (
    <SectionPageView title={sectionText.label} description={sectionText.description} wide>
      <SettingsToolbar>
        <StatesToolbar projectKey={project.project.key} columns={project.columns} />
      </SettingsToolbar>
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsStates project={project} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
