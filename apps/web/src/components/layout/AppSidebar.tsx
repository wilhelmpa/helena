'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import type { Project } from '@/lib/api/endpoints/projects';
import type { View } from '@/lib/api/endpoints/views';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';
import SidebarProjectSwitcher from './SidebarProjectSwitcher';
import { SidebarHomeTree, SidebarPersonalNav, SidebarProjectTree } from './SidebarTreeNav';
import { APP_NAME } from '@/utils/app';
import { Search, MessageSquare, Globe2, Terminal, Code2, Mail } from 'lucide-react';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import type { ViewTemplate } from '@/hooks/useViewEditor';

export default function AppSidebar({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewProject,
  onNewView,
  onEditView,
  onDeleteView,
  onOpenCommand,
  onSelectTool,
  activeTool,
  openTools,
  onSettings,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewProject: () => void;
  onNewView: (template: ViewTemplate) => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
  onOpenCommand: () => void;
  onSelectTool: (tool: WorkspaceToolId) => void;
  activeTool: WorkspaceToolId | null;
  openTools: string[];
  onSettings: () => void;
}) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const side = useSidebarSide();
  const sidebar = useSidebar();
  const teamIds = [...new Set(projects.map((project) => project.teamId))];
  const homeTeamId = teamIds.length === 1 ? teamIds[0]! : null;
  const [clock, setClock] = useState('');
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const updateClock = () =>
      setClock(
        new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date()),
      );
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, [locale]);

  return (
    <Sidebar collapsible="offcanvas" side={side} className="helena-sidebar">
      <SidebarHeader className="helena-sidebar-header">
        <div className="helena-sidebar-brand">
          <span>{APP_NAME.toUpperCase()}</span>
          <span className="flex items-center gap-2">
            <time suppressHydrationWarning>{clock}</time>
            <button
              type="button"
              aria-label={t('search')}
              title="Suchen (⌘K)"
              onClick={onOpenCommand}
              className="helena-sidebar-search"
            >
              <Search size={14} />
            </button>
          </span>
        </div>
        <SidebarProjectSwitcher
          projects={projects}
          currentProjectKey={currentProjectKey}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
        />
      </SidebarHeader>
      <SidebarContent className="helena-sidebar-content">
        <SidebarPersonalNav teamIds={teamIds} projectKey={currentProjectKey} projects={projects} />
        {currentProjectKey ? (
          <SidebarProjectTree
            projectKey={currentProjectKey}
            onNewView={onNewView}
            onEditView={onEditView}
            onDeleteView={onDeleteView}
          />
        ) : (
          <SidebarHomeTree teamId={homeTeamId} isGod={mounted && session?.user.role === 'god'} />
        )}
      </SidebarContent>
      <SidebarFooter className="helena-sidebar-footer">
        <div className="helena-sidebar-tools">
          <span>{t('tools')}</span>
          <div>
            {(
              [
                ['chat', MessageSquare, 'Chat'],
                ['browser', Globe2, 'Browser'],
                ['terminal', Terminal, 'Terminal'],
                ['code', Code2, 'Code'],
                ['mail', Mail, 'Mail'],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={activeTool === id}
                onClick={() => {
                  onSelectTool(id);
                  if (sidebar.isMobile) sidebar.setOpenMobile(false);
                }}
              >
                <Icon size={16} />
                {openTools.includes(id) && <i />}
              </button>
            ))}
          </div>
        </div>
        <SidebarAccountRow onSettings={onSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
