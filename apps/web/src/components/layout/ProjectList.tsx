import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Home } from 'lucide-react';
import type { Project } from '@/lib/api/endpoints/projects';
import { projectTree } from '@/utils/projectTree';
import { runtimeEnv } from '@/utils/runtimeEnv';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import ProjectTreeGroup from '@/components/layout/ProjectTreeGroup';
import ProjectTreeItem from '@/components/layout/ProjectTreeItem';
import ProjectUngroupDropZone from '@/components/layout/ProjectUngroupDropZone';

// The projects as a tree: the organization's departments with their projects, then the
// projects without one. The collapsed sidebar lists them flat, as icons.
export default function ProjectList({
  projects,
  currentProjectKey,
  onSelectProject,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const homeChatProjectKey = runtimeEnv().workspace.homeChatProjectKey;
  const visibleProjects = projects.filter((project) => project.key !== homeChatProjectKey);
  const { groups, ungrouped } = projectTree(visibleProjects);
  const [dragging, setDragging] = useState(false);
  const item = (project: Project) => (
    <ProjectTreeItem
      key={project.key}
      project={project}
      active={project.key === currentProjectKey}
      groups={groups}
      onSelect={onSelectProject}
      onDragChange={setDragging}
    />
  );

  return (
    <SidebarGroup className="max-h-[45%] min-h-0 shrink-0 overflow-hidden pt-2">
      <SidebarGroupContent className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/'} tooltip={t('home')}>
              <Link href="/">
                <Home />
                <span>{t('home')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {visibleProjects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t('noProjects')}
          </p>
        ) : (
          <>
            <SidebarMenu className="mt-1 hidden group-data-[collapsible=icon]:flex">
              {visibleProjects.map(item)}
            </SidebarMenu>
            <SidebarMenu className="mt-1 ps-3 group-data-[collapsible=icon]:hidden">
              {groups.map((group) => (
                <ProjectTreeGroup
                  key={group.id}
                  group={group}
                  groups={groups}
                  currentProjectKey={currentProjectKey}
                  onSelectProject={onSelectProject}
                  onDragChange={setDragging}
                />
              ))}
              {ungrouped.map(item)}
              {dragging && groups.length > 0 && (
                <ProjectUngroupDropZone onDragChange={setDragging} />
              )}
            </SidebarMenu>
          </>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
