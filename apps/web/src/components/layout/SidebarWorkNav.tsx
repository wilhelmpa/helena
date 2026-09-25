import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  FileText,
  Folder,
  Inbox,
  LayoutDashboard,
  ReceiptText,
  RefreshCw,
  SquareKanban,
  StickyNote,
  Target,
} from 'lucide-react';
import {
  cyclesPath,
  dashboardsPath,
  documentsPath,
  filesPath,
  inboxPath,
  initiativesPath,
  notesPath,
  projectPath,
  receiptsPath,
} from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarAreaNav from '@/components/layout/SidebarAreaNav';

export default function SidebarWorkNav({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  // Receipts are finance data: the project's administrators only, as on the API.
  const { isAdmin } = usePermissions();
  const features = useProjectFeatures();
  const disabled = !projectKey;
  const onWorkItems =
    !!projectKey &&
    (pathname === projectPath(projectKey) ||
      pathname.startsWith(`${projectPath(projectKey)}/view`) ||
      pathname.startsWith(`${projectPath(projectKey)}/issue`));

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('groups.work')}</SidebarGroupLabel>
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
          {projectKey && can('views', 'read') && <SidebarAreaNav projectKey={projectKey} />}
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
          {isAdmin && (
            <SidebarNavItem
              href={projectKey ? receiptsPath(projectKey) : '#'}
              icon={ReceiptText}
              label={t('receipts')}
              active={pathname.includes('/receipts')}
              disabled={disabled}
            />
          )}
          {features.initiatives && can('initiatives', 'read') && (
            <SidebarNavItem
              href={projectKey ? initiativesPath(projectKey) : '#'}
              icon={Target}
              label={t('initiatives')}
              active={pathname.includes('/initiatives')}
              disabled={disabled}
            />
          )}
          {features.cycles && can('cycles', 'read') && (
            <SidebarNavItem
              href={projectKey ? cyclesPath(projectKey) : '#'}
              icon={RefreshCw}
              label={t('cycles')}
              active={pathname.includes('/cycles')}
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
