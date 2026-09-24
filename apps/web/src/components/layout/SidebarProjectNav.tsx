import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import { useProjectSettingsNavItems } from '@/hooks/useProjectSettingsNavItems';
import SidebarAutomationNav from '@/components/layout/SidebarAutomationNav';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarWorkNav from '@/components/layout/SidebarWorkNav';

// The navigation of the selected project: its work, its agents and automation, and one
// entry into its settings. The settings pages themselves are listed only in the settings'
// own second column (ProjectSettingsShell), not here a second time (owner, 2026-09-24:
// "die Einträge nicht in der Main-Sidebar, sondern in der Secondary-Sidebar").
export default function SidebarProjectNav({ projectKey }: { projectKey: string }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const settings = useProjectSettingsNavItems(projectKey);
  const first = settings.find((item) => item.key === 'general') ?? settings[0];

  return (
    <>
      <SidebarWorkNav projectKey={projectKey} />
      <SidebarAutomationNav projectKey={projectKey} />
      {first && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarNavItem
                href={first.href}
                icon={Settings}
                label={t('projectSettings')}
                active={settings.some((item) => item.active || pathname === item.href)}
                disabled={false}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
