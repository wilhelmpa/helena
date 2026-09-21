'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Braces, Server, Shield, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useSession } from '@/lib/auth-client';
import { apiDocsPath, godPath, mcpServerPath } from '@/utils/paths';
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

// The app sidebar. It has two modes driven by the route: the main work
// navigation, and the project settings navigation reached through the "Project
// settings" entry. Projects stay visible in the scrollable sidebar in both modes.
// Creating and deleting a project live in the team panel on Manage teams.
export default function AppSidebar({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewTeam,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewTeam: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const disabled = !currentProjectKey;

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
  const settingsMode = settingsNav.groups.some((g) => g.items.some((i) => i.active));
  const onApiDocs = pathname.endsWith('/api');
  const onMcp = pathname.endsWith('/mcp');
  const side = useSidebarSide();

  return (
    <Sidebar collapsible="icon" side={side}>
      <SidebarHeader className="h-12 shrink-0 justify-center border-b px-4 py-0">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {t('projects')}
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title={t('newTeam')}
            onClick={onNewTeam}
          >
            <UserPlus className="size-4" />
            <span className="sr-only">{t('newTeam')}</span>
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
          {settingsMode ? (
            <SidebarSettingsNav projectKey={currentProjectKey} />
          ) : (
            <SidebarMainNav projectKey={currentProjectKey} />
          )}
        </div>
      </SidebarContent>

      {!settingsMode && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarNavItem
              href={currentProjectKey ? apiDocsPath(currentProjectKey) : '#'}
              icon={Braces}
              label={t('apiDocs')}
              active={onApiDocs}
              disabled={disabled}
            />
            <SidebarNavItem
              href={currentProjectKey ? mcpServerPath(currentProjectKey) : '#'}
              icon={Server}
              label={t('mcpServer')}
              active={onMcp}
              disabled={disabled}
            />
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
