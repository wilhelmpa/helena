'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderPlus, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { godPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import { useAccountPreferences } from '@/services/preferences.service';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import ProjectList from '@/components/layout/ProjectList';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarProjectNav from '@/components/layout/SidebarProjectNav';
import SidebarHomeNav from '@/components/layout/SidebarHomeNav';
import SidebarBrand from '@/components/brand/SidebarBrand';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';

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
  // 'single' (the default) is the only reason this row exists: it carries the
  // language/theme/account controls the single-row header no longer has room for.
  // 'classic' keeps them in AppHeader instead, exactly where they are today.
  const { headerLayout } = useAccountPreferences();

  // Whether rows are hidden below the navigation's bottom edge: only then does its last
  // visible row fade out, so a list that fits never looks greyed at its end.
  const navRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    const check = () => setMoreBelow(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    node.addEventListener('scroll', check, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', check);
    };
  }, [currentProjectKey]);

  return (
    <Sidebar collapsible="icon" side={side}>
      <SidebarHeader className="h-12 shrink-0 justify-center px-2 py-0">
        <div className="flex items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center">
          <SidebarBrand className="min-w-0 flex-1" />
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
        {/* A long navigation scrolls; while rows are hidden below, its last visible row
            fades out instead of being cut off hard at the footer. */}
        <div
          ref={navRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain group-data-[collapsible=icon]:overflow-hidden',
            moreBelow &&
              '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]',
          )}
        >
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
        {headerLayout === 'single' && (
          <>
            <SidebarSeparator />
            <SidebarAccountRow />
          </>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
