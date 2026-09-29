'use client';

import { projectSettingsPages } from '@/features/settings/projectSettingsPages';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Crumb } from '@/design-system';
import type { ShellRoute } from '@/hooks/useShellRoute';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { SETTINGS_SECTIONS } from '@/utils/settingsSections';
import {
  aiTeamPath,
  dashboardsPath,
  filesPath,
  homeFilesPath,
  projectPath,
  receiptsPath,
  settingsPath,
} from '@/utils/paths';
import { knowledgeFolderLabel, type FixedFolderKey } from '@/utils/knowledgeFolders';
import { projectColor } from '@/utils/projectColor';

export type ShellHeading = { crumbs: Crumb[]; title: string; accent: string };

// The folders above an open folder or file of Wissen, each a link, and the title: the file
// (by its name without extension) or the folder. `fixed` translates a project's fixed
// folders (Docs → Dokumente …) on the first level.
function knowledgeTrail(
  search: URLSearchParams | null,
  href: (folder: string) => string | undefined,
  label: (segment: string, depth: number) => string = (segment) => segment,
): { crumbs: Crumb[]; title: string | null } {
  const file = search?.get('file') ?? null;
  const folder = search?.get('path') ?? '';
  const target = file ?? folder;
  if (!target) return { crumbs: [], title: null };
  const parts = target.split('/').filter(Boolean);
  const crumbs = parts.slice(0, -1).map((segment, depth) => ({
    label: label(segment, depth),
    href: href(parts.slice(0, depth + 1).join('/')),
  }));
  const last = parts.at(-1)!;
  const title = file
    ? last.replace(/\.(md|markdown|canvas|base)$/i, '')
    : label(last, parts.length - 1);
  return { crumbs, title };
}

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
  const tFixed = useTranslations('files.fixedFolders');
  const tRoots = useTranslations('files.roots');
  const tReceipts = useTranslations('receipts.tabs');
  const sectionText = useSettingsSectionText();
  const pathname = usePathname();
  const search = useSearchParams();

  if (globalHome) {
    const home = t('sidebarHome');
    const area = /^\/(tasks|issue)(\/|$)/.test(pathname)
      ? t('workItems')
      : /^\/(files|docs|vault)(\/|$)/.test(pathname)
        ? t('sidebarKnowledge')
        : /^\/(organization|agents)(\/|$)/.test(pathname) && search.get('tab') !== 'goals'
          ? t('sidebarTeam')
          : /^\/(schedules|workflows|activity|browsers|decisions)(\/|$)/.test(pathname)
            ? t('sidebarAutomation')
            : /^\/(dashboard|system)(\/|$)/.test(pathname)
              ? t('dashboards')
              : /^\/settings(\/|$)/.test(pathname)
                ? t('settings')
                : null;
    const title = globalTitle ?? home;
    if (/^\/files(\/|$)/.test(pathname)) {
      const knowledge = { label: t('sidebarKnowledge'), href: '/files' };
      const root = search.get('root');
      if (!root && !search.get('project'))
        return {
          crumbs: [{ label: home, href: '/' }, ...(search.get('kind') ? [knowledge] : [])],
          title: search.get('kind') === 'files' ? t('sidebarFiles') : t('sidebarKnowledge'),
          accent: projectColor(null),
        };
      const place =
        root === 'private' || root === 'templates' || root === 'home'
          ? { label: tRoots(root), href: homeFilesPath('', { root }) }
          : { label: search.get('project') ?? tRoots('projects') };
      const trail = knowledgeTrail(search, (folder) =>
        root === 'project' ? undefined : homeFilesPath(folder, { root: root ?? undefined }),
      );
      return {
        crumbs: [{ label: home, href: '/' }, knowledge, ...(trail.title ? [place] : []), ...trail.crumbs],
        title: trail.title ?? place.label,
        accent: projectColor(null),
      };
    }
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
  // Wissen, Dateien and Belege are one entry of the sidebar with three views (owner 29.09.):
  // the breadcrumb is the whole path — project · Wissen · folder … — and the title the
  // folder, the file or the view; the page shows no second path (O16).
  if (sub === 'files' || sub === 'docs' || sub === 'notes') {
    const knowledge = { label: t('sidebarKnowledge'), href: filesPath(key) };
    const trail = knowledgeTrail(
      search,
      (folder) => filesPath(key, folder),
      (segment, depth) =>
        depth === 0 ? knowledgeFolderLabel(segment, (fixed: FixedFolderKey) => tFixed(fixed)) : segment,
    );
    if (trail.title) return heading([project, knowledge, ...trail.crumbs], trail.title);
    return search?.get('kind') === 'files'
      ? heading([project, knowledge], t('sidebarFiles'))
      : heading([project], t('sidebarKnowledge'));
  }
  if (sub === 'receipts') {
    const view = search?.get('view');
    const knowledge = { label: t('sidebarKnowledge'), href: filesPath(key) };
    return view && ['open', 'review', 'matched', 'export'].includes(view)
      ? heading(
          [project, knowledge, { label: t('receipts'), href: receiptsPath(key) }],
          tReceipts(view as never),
        )
      : heading([project, knowledge], t('receipts'));
  }
  if (sub === 'inbox' || sub === 'approvals') return heading([project], t('sidebarInbox'));
  const automation = t('sidebarAutomation');
  // Team is its own entry of the sidebar (owner, O55); Automatisierung holds the rest.
  if (sub === 'organization' || sub === 'ai-agents') return heading([project], t('sidebarTeam'));
  const schedules = aiTeamPath(key, 'schedules');
  if (sub === 'ai-team')
    return heading(
      area(automation, schedules),
      aiTeamSection && known(aiTeamSection)
        ? sectionText(aiTeamSection).label
        : t('sidebarSchedules'),
    );
  if (sub === 'workflows') return heading(area(automation, schedules), t('workflows'));
  if (sub === 'activity') return heading(area(automation, schedules), t('sidebarHistory'));
  if (sub === 'chat') return heading([project], t('chat'));
  if (sub === 'code') return heading([project], t('workspace.code'));
  if (sub === 'browser-lab') return heading([project], t('browserLab'));
  if (sub === 'api') return heading([project], t('api'));
  const settings = t('settings');
  const general = settingsPath(key, 'general');
  if (section) {
    // A page the sidebar names itself (Erweiterungen, Standard-Ausführung …) keeps that name.
    const listed = projectSettingsPages(key).find((page) => page.slug === section)?.labelKey;
    return heading(
      area(settings, general),
      section === 'danger-zone'
        ? t('dangerZone')
        : listed
          ? t(listed as never)
          : known(section)
            ? sectionText(section).label
            : t('projectSettings'),
    );
  }
  if (sub === 'members') return heading(area(settings, general), t('members'));
  if (sub === 'notifications') return heading(area(settings, general), t('notifications'));
  if (sub === 'mcp') return heading(area(settings, general), t('mcpServer'));
  return heading([project], t('workItems'));
}
