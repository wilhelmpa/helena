import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BookOpenText,
  LayoutDashboard,
  RefreshCw,
  SquareKanban,
  StickyNote,
  Target,
  Workflow,
} from 'lucide-react';
import {
  cyclesPath,
  dashboardsPath,
  documentsPath,
  initiativesPath,
  notesPath,
  projectPath,
} from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarWorkItemsNav from '@/components/layout/SidebarWorkItemsNav';

// The top sidebar group. An entry appears only when its project feature is on and
// the user may read the section.
export default function SidebarWorkNav({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const disabled = !projectKey;
  const { data: views = [] } = useViewsQuery(projectKey);
  const { data: folders = [] } = useViewFoldersQuery(projectKey);

  // "Work items" is the default view: active on the project root and any segment
  // that is not one of the other top-level destinations.
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
          {projectKey ? (
            <SidebarWorkItemsNav
              projectKey={projectKey}
              label={t('workItems')}
              allLabel={t('allWorkItems')}
              pathname={pathname}
              onWorkItems={onWorkItems}
              views={views}
              folders={folders}
            />
          ) : (
            <SidebarNavItem
              href="#"
              icon={SquareKanban}
              label={t('workItems')}
              active={onWorkItems}
              disabled
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
          {features.documents && can('documents', 'read') && (
            <SidebarNavItem
              href={projectKey ? documentsPath(projectKey) : '#'}
              icon={BookOpenText}
              label={t('documents')}
              active={pathname.includes('/docs')}
              disabled={disabled}
            />
          )}
          {can('actions', 'read') && (
            <SidebarNavItem
              href={projectKey ? `${projectPath(projectKey)}/workflows` : '#'}
              icon={Workflow}
              label={t('workflows')}
              active={!!projectKey && pathname === `${projectPath(projectKey)}/workflows`}
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
