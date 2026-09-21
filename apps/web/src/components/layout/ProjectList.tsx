import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Home, SquareKanban, Users, Network, PlugZap } from 'lucide-react';
import type { Project } from '@/lib/api/endpoints/projects';
import { manageTeamsPath } from '@/utils/paths';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

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

  return (
    <SidebarGroup className="max-h-[45%] min-h-0 shrink-0 overflow-hidden pt-2">
      <SidebarGroupContent className="min-h-0 overflow-y-auto overscroll-contain">
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
        {projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t('noProjects')}
          </p>
        ) : (
          <SidebarMenu className="mt-1 ps-3 group-data-[collapsible=icon]:ps-0">
            {projects.map((project) => (
              <SidebarMenuItem key={project.key}>
                <SidebarMenuButton
                  isActive={project.key === currentProjectKey}
                  tooltip={`${project.name} (${project.key})`}
                  onClick={() => onSelectProject(project.key)}
                >
                  <SquareKanban />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {project.key}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
        <SidebarMenu className="mt-4 border-t border-sidebar-border/60 pt-3">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === '/organization'}
              tooltip={t('organization')}
            >
              <Link href="/organization">
                <Network />
                <span>{t('organization')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === '/connections'}
              tooltip={t('connections')}
            >
              <Link href="/connections">
                <PlugZap />
                <span>{t('connections')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('manageTeams')}>
              <Link href={manageTeamsPath()}>
                <Users />
                <span>{t('manageTeams')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
