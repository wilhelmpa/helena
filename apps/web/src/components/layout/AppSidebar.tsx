'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import type { View } from '@/lib/api/endpoints/views';
import { useSession } from '@/lib/auth-client';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';
import SidebarProjectSwitcher from './SidebarProjectSwitcher';
import { SidebarHomeTree, SidebarPersonalNav, SidebarProjectTree } from './SidebarTreeNav';
import { APP_NAME } from '@/utils/app';
import { Search, MessageSquare, Globe2, Terminal, Code2, Mail, Settings } from 'lucide-react';
import type { WorkspaceToolId } from '@/utils/workspaceTools';

export default function AppSidebar({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewProject,
  onNewView,
  onEditView,
  onDeleteView,
  onOpenCommand,
  onSettings,
  onSelectTool,
  activeTool,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewProject: () => void;
  onNewView: () => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
  onOpenCommand: () => void;
  onSettings: () => void;
  onSelectTool: (tool: WorkspaceToolId) => void;
  activeTool: WorkspaceToolId | null;
}) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const side = useSidebarSide();
  const teamIds = [...new Set(projects.map((project) => project.teamId))];
  const homeTeamId = teamIds.length === 1 ? teamIds[0]! : null;
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [clock, setClock] = useState('');

  useEffect(() => {
    setMounted(true);
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
                onClick={() => onSelectTool(id)}
              >
                <Icon size={16} />
                {activeTool === id && <i />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <SidebarAccountRow />
          <button
            type="button"
            aria-label={t('settings')}
            title={t('settings')}
            onClick={onSettings}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings size={16} />
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
