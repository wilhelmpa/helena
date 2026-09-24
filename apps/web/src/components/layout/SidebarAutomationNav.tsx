import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Bot, Clock3, Network, ShieldCheck, Workflow } from 'lucide-react';
import {
  agentActivityPath,
  aiAgentsPath,
  aiTeamPath,
  organizationPath,
  projectApprovalsPath,
  workflowsPath,
} from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// Who works in the project and what runs on its own: the agents, how they work as a
// team, what they did, its workflows, its approvals and the schedules.
export default function SidebarAutomationNav({ projectKey }: { projectKey: string }) {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const pathname = usePathname();
  const { can } = usePermissions();
  const schedulesHref = aiTeamPath(projectKey, 'schedules');
  const mayDecide = can('ai_agents', 'edit');
  const pendingCount = usePendingApprovalCount(projectKey, mayDecide);
  const pipelineApprovals = usePipelineApprovals(mayDecide);
  const pendingApprovals =
    (pendingCount.data?.count ?? 0) +
    (pipelineApprovals.data?.filter((approval) => approval.projectKey === projectKey).length ?? 0);

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
          {can('ai_agents', 'read') && (
            <SidebarNavItem
              href={agentActivityPath(projectKey)}
              icon={Activity}
              label={t('agentActivity')}
              active={pathname.startsWith(agentActivityPath(projectKey))}
              disabled={false}
            />
          )}
          {mayDecide && (
            <SidebarNavItem
              href={projectApprovalsPath(projectKey)}
              icon={ShieldCheck}
              label={t('approvals')}
              active={pathname.startsWith(projectApprovalsPath(projectKey))}
              disabled={false}
              badge={pendingApprovals}
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
