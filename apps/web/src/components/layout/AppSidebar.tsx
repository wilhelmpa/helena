'use client';

import { useEffect, useState } from 'react';
import { FolderPlus, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useSession } from '@/lib/auth-client';
import { APP_NAME } from '@/utils/app';
import { godPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
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
import SidebarProjectNav from '@/components/layout/SidebarProjectNav';
import SidebarHomeNav from '@/components/layout/SidebarHomeNav';
import VolitionMark from '@/components/brand/VolitionMark';
import VolitionWordmark from '@/components/brand/VolitionWordmark';

// The app sidebar: the projects, then either the navigation of the selected project
// (its work, its agents and automation, its settings folded under one entry) or, with
// no project selected, the Home navigation (the work across every project, the team's
// agents and the settings every project shares).
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

  const side = useSidebarSide();

  return (
    <Sidebar collapsible="icon" side={side}>
      <SidebarHeader className="h-12 shrink-0 justify-center px-4 py-0 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <span className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
            <VolitionMark className="size-6 shrink-0" />
            <VolitionWordmark label={APP_NAME} className="h-3.5 w-auto text-sidebar-foreground" />
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
          {currentProjectKey ? (
            <SidebarProjectNav projectKey={currentProjectKey} />
          ) : (
            <SidebarHomeNav teamId={homeTeamId} teamIds={[...teamIds]} />
          )}
        </div>
      </SidebarContent>

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

      <SidebarRail />
    </Sidebar>
  );
}
