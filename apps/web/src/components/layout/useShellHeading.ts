'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Crumb } from '@/design-system';
import type { ShellRoute } from '@/hooks/useShellRoute';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { SETTINGS_SECTIONS } from '@/utils/settingsSections';
import { dashboardsPath, organizationPath, projectPath, settingsPath } from '@/utils/paths';
import { projectColor } from '@/utils/projectColor';

export type ShellHeading = { crumbs: Crumb[]; title: string; accent: string };

// The page header of every page (docs/design-system.md §3): the breadcrumb as a mono
// label in the project colour — project, area — then the page's own title. The area is
// the level-1 entry of the sidebar the page belongs to; a page that is that area itself
// shows the area as its title and only the project before it.
export function useShellHeading({
  route,
  globalHome,
  globalTitle,
  projectName,
  issueIdentifier,
  issueTitle,
  viewName,
}: {
  route: ShellRoute;
  globalHome: boolean;
  globalTitle?: string;
  projectName: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  viewName: string | null;
}): ShellHeading {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const pathname = usePathname();
  const search = useSearchParams();

  if (globalHome) {
    const home = t('sidebarHome');
    const area = /^\/(tasks|issue)(\/|$)/.test(pathname)
      ? t('workItems')
      : /^\/(files|docs|vault)(\/|$)/.test(pathname)
        ? t('sidebarKnowledge')
        : /^\/(organization|agents|schedules|workflows|activity|browsers|decisions)(\/|$)/.test(
              pathname,
            ) && search.get('tab') !== 'goals'
          ? t('sidebarAutomation')
          : /^\/(dashboard|system)(\/|$)/.test(pathname)
            ? t('dashboards')
            : /^\/settings(\/|$)/.test(pathname)
              ? t('settings')
              : null;
    const title = globalTitle ?? home;
    return {
      crumbs: [{ label: home, href: '/' }, ...(area && area !== title ? [{ label: area }] : [])],
      title,
      accent: projectColor(null),
    };
  }

  const key = route.projectKey;
  const project = {
    label: projectName ?? t('project'),
    href: key ? dashboardsPath(key) : undefined,
  };
  const accent = projectColor(key);
  const known = (slug: string) => SETTINGS_SECTIONS.some((section) => section.slug === slug);
  const { sub, section, aiTeamSection } = route;

  const area = (label: string, href?: string) => [project, { label, href }];
  const heading = (crumbs: Crumb[], title: string): ShellHeading => ({ crumbs, title, accent });

  if (!key) return heading([], t('workItems'));
  if (route.routeIssueSeq != null)
    return heading(
      area(t('workItems'), projectPath(key)),
      issueIdentifier ? `${issueIdentifier}${issueTitle ? ` ${issueTitle}` : ''}` : t('workItems'),
    );
  if (sub == null) return heading([project], t('workItems'));
  if (sub === 'view')
    return heading(area(t('workItems'), projectPath(key)), viewName ?? t('workItems'));
  if (sub === 'cycles') return heading(area(t('workItems'), projectPath(key)), t('cycles'));
  if (sub === 'dashboard')
    return pathname.split('/').length > 4
      ? heading(area(t('dashboards'), dashboardsPath(key)), viewName ?? t('dashboards'))
      : heading([project], t('dashboards'));
  if (sub === 'initiatives') return heading([project], t('sidebarGoals'));
  if (sub === 'files' || sub === 'docs' || sub === 'notes')
    return heading(
      [project],
      search?.get('kind') === 'files' ? t('sidebarFiles') : t('sidebarKnowledge'),
    );
  if (sub === 'receipts') return heading([project], t('receipts'));
  if (sub === 'inbox' || sub === 'approvals') return heading([project], t('sidebarInbox'));
  const automation = t('sidebarAutomation');
  if (sub === 'organization' || sub === 'ai-agents')
    return heading(area(automation), t('sidebarTeam'));
  if (sub === 'ai-team')
    return heading(
      area(automation, organizationPath(key)),
      aiTeamSection && known(aiTeamSection)
        ? sectionText(aiTeamSection).label
        : t('sidebarSchedules'),
    );
  if (sub === 'workflows') return heading(area(automation, organizationPath(key)), t('workflows'));
  if (sub === 'activity')
    return heading(area(automation, organizationPath(key)), t('sidebarHistory'));
  if (sub === 'chat') return heading([project], t('chat'));
  if (sub === 'code') return heading([project], t('workspace.code'));
  if (sub === 'browser-lab') return heading([project], t('browserLab'));
  if (sub === 'api') return heading([project], t('api'));
  const settings = t('settings');
  const general = settingsPath(key, 'general');
  if (section)
    return heading(
      area(settings, general),
      section === 'danger-zone'
        ? t('dangerZone')
        : known(section)
          ? sectionText(section).label
          : section === 'mail'
            ? t('mail')
            : t('projectSettings'),
    );
  if (sub === 'members') return heading(area(settings, general), t('members'));
  if (sub === 'notifications') return heading(area(settings, general), t('notifications'));
  if (sub === 'mcp') return heading(area(settings, general), t('mcpServer'));
  return heading([project], t('workItems'));
}
