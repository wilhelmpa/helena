'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsToolbar from './components/SettingsToolbar';
import { useSettingsAddAction } from './components/crud/SettingsHeaderAddButton';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import IssueTypesToolbar from './components/issue-types/IssueTypesToolbar';
import SettingsIssueTypes from './components/issue-types/SettingsIssueTypes';

const section = settingsSection('issue-types');

// The Issue types settings page (/project/:projectKey/settings/issue-types).
export default function SettingsIssueTypesPage() {
  const tTypes = useTranslations('settings.issueTypes');
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  // The add form is inline in the list; the header button opens it via this flag.
  const [adding, setAdding] = useState(false);
  const addAction = useSettingsAddAction(section.resource, tTypes('add'), () => setAdding(true));
  if (!project) return null;
  return (
    <SectionPageView title={sectionText.label} wide>
      <SettingsToolbar primary={addAction}>
        <IssueTypesToolbar
          projectKey={project.project.key}
          resource={section.resource}
          types={project.issueTypes}
        />
      </SettingsToolbar>
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <SettingsIssueTypes project={project} adding={adding} onAddingChange={setAdding} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
