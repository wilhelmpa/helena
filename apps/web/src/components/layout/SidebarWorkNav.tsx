import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Code2,
  FileText,
  Folder,
  Inbox,
  LayoutDashboard,
  SquareKanban,
  StickyNote,
  Target,
} from 'lucide-react';
import {
  codePath,
  dashboardsPath,
  documentsPath,
  filesPath,
  inboxPath,
  initiativesPath,
  notesPath,
  projectPath,
} from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

export default function SidebarWorkNav({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const disabled = !projectKey;
  const onWorkItems =
    !!projectKey &&
    (pathname === projectPath(projectKey) ||
      pathname.startsWith(`${projectPath(projectKey)}/view`) ||
      pathname.startsWith(`${projectPath(projectKey)}/issue`));

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {features.dashboards && can('dashboards', 'read') && (
            <SidebarNavItem
              href={projectKey ? dashboardsPath(projectKey) : '#'}
              icon={LayoutDashboard}
              label={t('dashboards')}
              active={pathname.includes('/dashboard')}
              disabled={disabled}
            />
          )}
          <SidebarNavItem
            href={projectKey ? projectPath(projectKey) : '#'}
            icon={SquareKanban}
            label={t('workItems')}
            active={onWorkItems}
            disabled={disabled}
          />
          <SidebarNavItem
            href={projectKey ? inboxPath(projectKey) : '#'}
            icon={Inbox}
            label={t('inbox')}
            active={!!projectKey && pathname === inboxPath(projectKey)}
            disabled={disabled}
          />
          {features.documents && can('documents', 'read') && (
            <SidebarNavItem
              href={projectKey ? documentsPath(projectKey) : '#'}
              icon={FileText}
              label={t('documents')}
              active={pathname.includes('/docs')}
              disabled={disabled}
            />
          )}
          {features.documents && can('documents', 'read') && (
            <SidebarNavItem
              href={projectKey ? filesPath(projectKey) : '#'}
              icon={Folder}
              label={t('workspace.files')}
              active={pathname.includes('/files')}
              disabled={disabled}
            />
          )}
          <SidebarNavItem
            href={projectKey ? codePath(projectKey) : '#'}
            icon={Code2}
            label={t('workspace.code')}
            active={!!projectKey && pathname === codePath(projectKey)}
            disabled={disabled}
          />
          {features.initiatives && can('initiatives', 'read') && (
            <SidebarNavItem
              href={projectKey ? initiativesPath(projectKey) : '#'}
              icon={Target}
              label={t('initiatives')}
              active={pathname.includes('/initiatives')}
              disabled={disabled}
            />
          )}
          {features.notes && can('note_boards', 'read') && (
            <SidebarNavItem
              href={projectKey ? notesPath(projectKey) : '#'}
              icon={StickyNote}
              label={t('notes')}
              active={pathname.includes('/notes')}
              disabled={disabled}
            />
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
