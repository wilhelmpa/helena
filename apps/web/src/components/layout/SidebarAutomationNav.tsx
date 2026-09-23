import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bot, Clock3, Network, Workflow } from 'lucide-react';
import { aiAgentsPath, aiTeamPath, organizationPath, workflowsPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// Who works in the project and what runs on its own: the agents, how they work as a
// team, the Mastra workflows and the schedules.
export default function SidebarAutomationNav({ projectKey }: { projectKey: string }) {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const pathname = usePathname();
  const { can } = usePermissions();
  const schedulesHref = aiTeamPath(projectKey, 'schedules');

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('groups.agents')}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {can('ai_agents', 'read') && (
            <SidebarNavItem
              href={aiAgentsPath(projectKey)}
              icon={Bot}
              label={t('aiAgents')}
              active={pathname.startsWith(aiAgentsPath(projectKey))}
              disabled={false}
            />
          )}
          {can('ai_agents', 'read') && (
            <SidebarNavItem
              href={organizationPath(projectKey)}
              icon={Network}
              label={t('teamOrchestration')}
              active={pathname.startsWith(organizationPath(projectKey))}
              disabled={false}
            />
          )}
          {can('actions', 'read') && (
            <SidebarNavItem
              href={workflowsPath(projectKey)}
              icon={Workflow}
              label={t('workflows')}
              active={pathname.startsWith(workflowsPath(projectKey))}
              disabled={false}
            />
          )}
          {can('ai_agents', 'read') && (
            <SidebarNavItem
              href={schedulesHref}
              icon={Clock3}
              label={sectionText('schedules').label}
              active={pathname === schedulesHref}
              disabled={false}
            />
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
