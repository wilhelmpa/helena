import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import { useProjectSettingsNavItems } from '@/hooks/useProjectSettingsNavItems';
import SidebarAutomationNav from '@/components/layout/SidebarAutomationNav';
import SidebarNavSubmenu from '@/components/layout/SidebarNavSubmenu';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';

// The navigation of the selected project: its work, its agents and automation, and its
// settings folded under one entry so they never replace the rest of the sidebar.
export default function SidebarProjectNav({ projectKey }: { projectKey: string }) {
  const t = useTranslations('nav');
  const settings = useProjectSettingsNavItems(projectKey);

  return (
    <>
      <SidebarWorkNav projectKey={projectKey} />
      <SidebarAutomationNav projectKey={projectKey} />
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarNavSubmenu icon={Settings} label={t('projectSettings')} items={settings} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
