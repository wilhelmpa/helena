'use client';

import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SettingsToolbar from './components/SettingsToolbar';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsBrowserGateway from './components/browser/SettingsBrowserGateway';

const section = settingsSection('browser');

// The browser gateway settings page (/project/:projectKey/settings/browser). Every control
// saves on its own, so the header row carries no save action, only the section switcher on
// a narrow screen.
export default function SettingsBrowserGatewayPage() {
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  if (!project) return null;
  return (
    <SectionPageView title={sectionText.label} description={sectionText.description}>
      <SettingsToolbar />
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsBrowserGateway project={project} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
