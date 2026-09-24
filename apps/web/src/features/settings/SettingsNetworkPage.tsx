'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsToolbar from './components/SettingsToolbar';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { SettingsResourceProvider } from './context/settingsPermission';
import SettingsNetworkForm from './components/network/SettingsNetworkForm';
import SettingsNetworkLog from './components/network/SettingsNetworkLog';
import { useAgentNetworkForm } from './hooks/useAgentNetworkForm';

const section = settingsSection('network');

// The agent network settings page (/project/:projectKey/settings/network): the
// egress mode, the allow/deny lists and the mail-port switch, with the connection
// log below. Save lives in the page header, like the other single-form sections.
export default function SettingsNetworkPage() {
  const { project } = useShell();
  if (!project) return null;
  return <NetworkPage projectKey={project.project.key} />;
}

function NetworkPage({ projectKey }: { projectKey: string }) {
  const t = useTranslations('settings.network');
  const tCommon = useTranslations('common');
  const sectionText = useSettingsSectionText()(section.slug);
  const { can } = usePermissions();
  const form = useAgentNetworkForm(projectKey);

  return (
    <SectionPageView title={sectionText.label} wide>
      <SettingsToolbar
        primary={
          can(section.resource, 'edit')
            ? {
                id: 'save',
                label: form.saving
                  ? tCommon('saving')
                  : form.justSaved
                    ? t('saved')
                    : tCommon('save'),
                icon: Check,
                disabled: !form.canSave,
                onClick: () => void form.save(),
              }
            : undefined
        }
      />
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          <div className="space-y-6">
            <SettingsNetworkForm form={form} />
            <SettingsNetworkLog projectKey={projectKey} />
          </div>
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
