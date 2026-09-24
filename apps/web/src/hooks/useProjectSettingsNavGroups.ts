import { Bell, Radio, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { mcpServerPath, membersPath, notificationsPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsNavGroups, type SettingsNavGroup } from '@/hooks/useSettingsNavGroups';

// The grouped project settings navigation for the in-page settings shell
// (docs/volition-design-helena-ui.md "Eigenes Einstellungs-Layout"): Projekt (general
// + members + notifications — "Allgemein, Status" plus the two routes the doc names
// alongside it), Arbeit (the states/issue-types/labels/custom-fields/issue-templates/
// configuration group useSettingsNavGroups already builds, relabeled), Agenten &
// Automatisierung (actions), Integrationen (MCP server, webhooks, git). The doc's
// fifth item, Gefahrenzone, is not a nav destination — it is the red-bordered
// section at the end of the Projekt/general page (see ProjectDangerZone).
//
// Reuses useSettingsNavGroups (also what the main sidebar's collapsed "Project
// settings" submenu builds from), so a permission change or a new section is one
// definition, not two.
export function useProjectSettingsNavGroups(projectKey: string): SettingsNavGroup[] {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  const { groups } = useSettingsNavGroups(projectKey);

  const generalItems = groups.find((g) => g.key === 'general')?.items ?? [];
  const workItems = groups.find((g) => g.key === 'workflow')?.items ?? [];
  const automationItems = groups.find((g) => g.key === 'automation')?.items ?? [];
  // The Autopilot is about the agents, next to their actions.
  const agentKeys = ['actions', 'autopilot'];
  const agentItems = automationItems.filter((item) => agentKeys.includes(item.key));
  const integrationItems = automationItems.filter((item) => !agentKeys.includes(item.key));

  const result: SettingsNavGroup[] = [
    {
      key: 'project',
      label: t('groups.project'),
      items: [
        ...generalItems,
        ...(can('members_manage', 'read')
          ? [
              {
                key: 'members',
                href: membersPath(projectKey),
                icon: Users,
                label: t('members'),
                active: pathname.includes('/members'),
              },
            ]
          : []),
        {
          key: 'notifications',
          href: notificationsPath(projectKey),
          icon: Bell,
          label: t('notifications'),
          active: pathname.includes('/notifications'),
        },
      ],
    },
    { key: 'work', label: t('groups.work'), items: workItems },
    { key: 'agents', label: t('groups.agents'), items: agentItems },
    {
      key: 'integrations',
      label: t('integrations'),
      items: [
        {
          key: 'mcp',
          href: mcpServerPath(projectKey),
          icon: Radio,
          label: t('mcpServer'),
          active: pathname.endsWith('/mcp'),
        },
        ...integrationItems,
      ],
    },
  ];

  return result.filter((group) => group.items.length > 0);
}
