'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Code2,
  Globe2,
  Mail,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Terminal,
} from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import type { Project } from '@/lib/api/endpoints/projects';
import type { View } from '@/lib/api/endpoints/views';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';
import { Tip } from '@/design-system';
import SidebarProjectSwitcher from './SidebarProjectSwitcher';
import { SidebarHomeTree, SidebarProjectTree } from './SidebarTreeNav';
import { APP_NAME } from '@/utils/app';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import type { ViewTemplate } from '@/hooks/useViewEditor';

// The sidebar (docs/design-system.md §6–§7, drafts ui-entwurf/Navigation-*, Shell*):
// HELENA (→ Home), clock and search; the project switcher; the tree (DU, PROJEKT); the
// tool row (WERKZEUGE: only the chosen tool is marked); the account with the settings
// gear. The only navigation of the app.
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
  rail,
  onToggleRail,
  onNavigate,
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
  rail: boolean;
  onToggleRail: () => void;
  // A tool was picked (closes the overlay sidebar on a narrow window; a followed link
  // closes it through the new page).
  onNavigate: () => void;
}) {
  const t = useTranslations('nav');
  const locale = useLocale();
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

  // The tool row (owner, O37): a chat symbol like the other tools, each with its name as
  // a tooltip — no orb here, the orb is the dock's.
  const tools: [WorkspaceToolId, typeof Globe2, string][] = [
    ['chat', MessageCircle, t('chat')],
    ['browser', Globe2, t('workspace.browser')],
    ['terminal', Terminal, t('workspace.terminal')],
    ['code', Code2, t('workspace.code')],
    ['mail', Mail, 'Mail'],
  ];

  return (
    <nav className="ds-sidebar" aria-label={t('sidebarProject')}>
      <div className="ds-sidebar-brand">
        <Link href="/" title={t('sidebarHome')}>
          <span className="ds-brand-full">{APP_NAME.toUpperCase()}</span>
          <span className="ds-brand-mark" aria-hidden="true">
            {APP_NAME.charAt(0).toUpperCase()}
          </span>
        </Link>
        <span className="ds-sidebar-brand-tools">
          <time suppressHydrationWarning>{clock}</time>
          <button
            type="button"
            aria-label={t('search')}
            title={`${t('search')} (⌘K)`}
            onClick={onOpenCommand}
            className="ds-sidebar-search"
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            aria-label={rail ? t('sidebarExpand') : t('sidebarCollapse')}
            title={rail ? t('sidebarExpand') : t('sidebarCollapse')}
            onClick={onToggleRail}
            className="ds-sidebar-search ds-sidebar-rail-toggle"
          >
            {rail ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </span>
      </div>
      <SidebarProjectSwitcher
        projects={projects}
        currentProjectKey={currentProjectKey}
        onSelectProject={onSelectProject}
        onNewProject={onNewProject}
      />
      <div className="ds-sidebar-scroll">
        {currentProjectKey ? (
          <SidebarProjectTree
            projectKey={currentProjectKey}
            projects={projects}
            teamIds={teamIds}
            onNewView={onNewView}
            onEditView={onEditView}
            onDeleteView={onDeleteView}
          />
        ) : (
          <SidebarHomeTree
            teamId={homeTeamId}
            isGod={mounted && session?.user.role === 'god'}
            teamIds={teamIds}
            projects={projects}
          />
        )}
      </div>
      <span className="ds-sidebar-label">{t('tools')}</span>
      <div className="ds-sidebar-tools">
        {tools.map(([id, Icon, label]) => (
          <Tip key={id} label={label}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={activeTool === id}
              onClick={() => {
                onSelectTool(id);
                onNavigate();
              }}
            >
              <Icon size={16} />
            </button>
          </Tip>
        ))}
      </div>
      <SidebarAccountRow />
    </nav>
  );
}
