import {
  ArrowLeft,
  Bell,
  Bot,
  Building2,
  Radio,
  RefreshCw,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  aiAgentsPath,
  cyclesPath,
  mcpServerPath,
  membersPath,
  notificationsPath,
  organizationPath,
  projectPath,
  workflowsPath,
} from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';

export interface SidebarSettingsItem {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
}

export interface SidebarSettingsSectionModel {
  key: string;
  label?: string;
  items: SidebarSettingsItem[];
}

export function useSidebarSettingsNavItems(
  projectKey: string | null,
): SidebarSettingsSectionModel[] {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const { groups } = useSettingsNavGroups(projectKey);
  const general = groups.find((group) => group.key === 'general');
  const workflow = groups.find((group) => group.key === 'workflow');
  const automation = groups.find((group) => group.key === 'automation');

  const item = (
    key: string,
    href: string,
    icon: LucideIcon,
    label: string,
    active: boolean,
  ): SidebarSettingsItem => ({ key, href, icon, label, active });

  const sections: SidebarSettingsSectionModel[] = [
    {
      key: 'back',
      items: [
        item(
          'back',
          projectKey ? projectPath(projectKey) : '#',
          ArrowLeft,
          t('backToProject'),
          false,
        ),
      ],
    },
    {
      key: 'project',
      label: t('groups.project'),
      items: [
        item(
          'organization',
          projectKey ? organizationPath(projectKey) : '#',
          Building2,
          t('organization'),
          !!projectKey && pathname === organizationPath(projectKey),
        ),
        ...(can('members_manage', 'read')
          ? [
              item(
                'members',
                projectKey ? membersPath(projectKey) : '#',
                Users,
                t('members'),
                pathname.includes('/members'),
              ),
            ]
          : []),
        item(
          'notifications',
          projectKey ? notificationsPath(projectKey) : '#',
          Bell,
          t('notifications'),
          pathname.includes('/notifications'),
        ),
        ...(general?.items ?? []),
      ],
    },
    {
      key: 'ai-team',
      label: t('aiTeam'),
      items: [
        ...(can('ai_agents', 'read')
          ? [
              item(
                'agents',
                projectKey ? aiAgentsPath(projectKey) : '#',
                Bot,
                t('aiAgents'),
                pathname.includes('/ai-agents'),
              ),
            ]
          : []),
        item(
          'mcp',
          projectKey ? mcpServerPath(projectKey) : '#',
          Radio,
          t('mcpServer'),
          pathname.endsWith('/mcp'),
        ),
      ],
    },
    {
      key: 'automation',
      label: t('groups.automation'),
      items: [
        ...(can('actions', 'read')
          ? [
              item(
                'workflows',
                projectKey ? workflowsPath(projectKey) : '#',
                Workflow,
                t('workflows'),
                pathname.includes('/workflows'),
              ),
            ]
          : []),
        ...(features.cycles && can('cycles', 'read')
          ? [
              item(
                'cycles',
                projectKey ? cyclesPath(projectKey) : '#',
                RefreshCw,
                t('cycles'),
                pathname.includes('/cycles'),
              ),
            ]
          : []),
        ...(automation?.items ?? []),
      ],
    },
  ];

  if (workflow) {
    sections.push({ key: 'workflow', label: workflow.label, items: workflow.items });
  }
  return sections;
}
