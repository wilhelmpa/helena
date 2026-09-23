'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FolderPlus, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useSession } from '@/lib/auth-client';
import { APP_NAME } from '@/utils/app';
import { godPath, projectPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from '@/components/ui/sidebar';
import ProjectList from '@/components/layout/ProjectList';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarMainNav from '@/components/layout/SidebarMainNav';
import SidebarSettingsNav from '@/components/layout/SidebarSettingsNav';
import SidebarHomeNav from '@/components/layout/SidebarHomeNav';

// The app sidebar. It has two modes driven by the route: the main work
// navigation, and the project settings navigation reached through the "Project
// settings" entry. Projects stay visible in the scrollable sidebar in both modes.
// Creating a project is available in the header; project administration is under Project settings.
export default function AppSidebar({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewProject,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewProject: () => void;
}) {
  const t = useTranslations('nav');
  const newProjectT = useTranslations('newProject');
  const pathname = usePathname();
  const teamIds = new Set(projects.map((project) => project.teamId));
  const homeTeamId = teamIds.size === 1 ? [...teamIds][0]! : null;

  const { data: session } = useSession();
  // The session store can already be filled by the time React hydrates, while the
  // server rendered without it. Reading it only after mount keeps the server and
  // the first client render identical, so the God mode entry does not break
  // hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && session?.user.role === 'god';

  // Settings mode is on whenever the route matches one of the settings nav items.
  // Members and the AI Team pages are not in those groups, so they keep the main
  // sidebar.
  const settingsNav = useSettingsNavGroups(currentProjectKey);
  const projectBase = currentProjectKey ? projectPath(currentProjectKey) : '';
  const configurationRoute =
    Boolean(projectBase) &&
    [
      '/organization',
      '/workflows',
      '/cycles',
      '/ai-agents',
      '/ai-team/',
      '/members',
      '/notifications',
      '/settings/',
      '/mcp',
    ].some((segment) => pathname.startsWith(`${projectBase}${segment}`));
  const settingsMode =
    configurationRoute || settingsNav.groups.some((g) => g.items.some((i) => i.active));
  const side = useSidebarSide();

  return (
    <Sidebar collapsible="icon" side={side}>
      <SidebarHeader className="h-12 shrink-0 justify-center border-b px-4 py-0">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {APP_NAME}
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title={newProjectT('title')}
            onClick={onNewProject}
          >
            <FolderPlus className="size-4" />
            <span className="sr-only">{newProjectT('title')}</span>
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-hidden">
        <ProjectList
          projects={projects}
          currentProjectKey={currentProjectKey}
          onSelectProject={onSelectProject}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain group-data-[collapsible=icon]:overflow-hidden">
          {!currentProjectKey ? (
            <SidebarHomeNav teamId={homeTeamId} />
          ) : settingsMode ? (
            <SidebarSettingsNav projectKey={currentProjectKey} />
          ) : (
            <SidebarMainNav projectKey={currentProjectKey} />
          )}
        </div>
      </SidebarContent>

      {!settingsMode && (
        <SidebarFooter>
          <SidebarMenu>
            {/* Instance administration, only for the owner account. The API
                  enforces the same, so hiding it here is about noise, not access. */}
            {isGod && (
              <SidebarNavItem
                href={godPath(GOD_SECTIONS[0]!.slug)}
                icon={Shield}
                label={t('godMode')}
                active={false}
                disabled={false}
              />
            )}
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  );
}
