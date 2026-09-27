'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import type { View } from '@/lib/api/endpoints/views';
import { useSession } from '@/lib/auth-client';
import { godPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import { APP_NAME } from '@/utils/app';
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

export default function AppSidebar({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewProject,
  onNewView,
  onEditView,
  onDeleteView,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewProject: () => void;
  onNewView: () => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
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
          <time suppressHydrationWarning>{clock}</time>
        </div>
        <SidebarProjectSwitcher
          projects={projects}
          currentProjectKey={currentProjectKey}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
        />
      </SidebarHeader>
      <SidebarContent className="helena-sidebar-content">
        <SidebarPersonalNav teamIds={teamIds} projectKey={currentProjectKey} />
        {currentProjectKey ? (
          <SidebarProjectTree
            projectKey={currentProjectKey}
            onNewView={onNewView}
            onEditView={onEditView}
            onDeleteView={onDeleteView}
          />
        ) : (
          <SidebarHomeTree teamId={homeTeamId} />
        )}
      </SidebarContent>
      <SidebarFooter className="helena-sidebar-footer">
        {mounted && session?.user.role === 'god' && (
          <Link href={godPath(GOD_SECTIONS[0]!.slug)} className="helena-sidebar-admin">
            {t('godMode')}
          </Link>
        )}
        <SidebarAccountRow />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
