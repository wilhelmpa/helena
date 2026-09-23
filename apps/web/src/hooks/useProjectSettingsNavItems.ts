import { Bell, Radio, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { mcpServerPath, membersPath, notificationsPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import type { SidebarNavSubmenuItem } from '@/components/layout/SidebarNavSubmenu';

// Every settings page of a project in one list, for the sidebar's "Project settings"
// entry: who is in the project and how it notifies, then the settings sections the
// viewer may read, grouped the way useSettingsNavGroups orders them.
export function useProjectSettingsNavItems(projectKey: string): SidebarNavSubmenuItem[] {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  const { groups } = useSettingsNavGroups(projectKey);

  return [
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
    {
      key: 'mcp',
      href: mcpServerPath(projectKey),
      icon: Radio,
      label: t('mcpServer'),
      active: pathname.endsWith('/mcp'),
    },
    ...groups.flatMap((group) => group.items),
  ];
}
