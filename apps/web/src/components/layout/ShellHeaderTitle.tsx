import { useTranslations } from 'next-intl';
import { SETTINGS_SECTIONS } from '@/utils/settingsSections';
import type { IssueRef } from '@/lib/api/endpoints/issues';
import type { ShellRoute } from '@/hooks/useShellRoute';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import CycleBreadcrumb from '@/components/layout/CycleBreadcrumb';
import InitiativeBreadcrumb from '@/components/layout/InitiativeBreadcrumb';
import IssueBreadcrumb from '@/components/layout/IssueBreadcrumb';
import HeaderCrumbs from '@/components/layout/HeaderCrumbs';
import { projectPath, settingsPath } from '@/utils/paths';

// The header title: a breadcrumb on an issue, initiative or cycle page; on any other
// page below the board, "project › page" (settings: "project › settings › section"),
// so the header says where the page sits and the page's own title bar under it does
// not repeat the same word in the same row. The board itself is just the project.
export default function ShellHeaderTitle({
  route,
  projectName,
  issueIdentifier,
  issueParent,
}: {
  route: ShellRoute;
  projectName: string;
  issueIdentifier: string | null;
  issueParent: IssueRef | null;
}) {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();

  // The label on the pages that are not an issue, initiative or cycle detail. An
  // /ai-team route names its section.
  function pageLabel(): string {
    const { sub, section, aiTeamSection } = route;
    const known = (slug: string) => SETTINGS_SECTIONS.some((s) => s.slug === slug);
    if (section) return known(section) ? sectionText(section).label : t('projectSettings');
    if (sub === 'workflows') return t('workflows');
    if (sub === 'activity') return t('agentActivity');
    if (sub === 'inbox') return t('inbox');
    if (sub === 'files') return t('workspace.files');
    if (sub === 'code') return t('workspace.code');
    if (sub === 'docs') return t('documents');
    if (sub === 'members') return t('members');
    if (sub === 'dashboard') return t('dashboards');
    if (sub === 'initiatives') return t('initiatives');
    if (sub === 'cycles') return t('cycles');
    if (sub === 'notes') return t('notes');
    if (sub === 'chat') return t('chat');
    if (sub === 'approvals') return t('approvals');
    if (sub === 'organization') return t('teamOrchestration');
    if (sub === 'notifications') return t('notifications');
    if (sub === 'mcp') return t('mcpServer');
    if (aiTeamSection) return known(aiTeamSection) ? sectionText(aiTeamSection).label : t('aiTeam');
    if (sub === 'ai-agents') return t('aiAgents');
    if (sub === 'api') return t('api');
    return projectName;
  }

  if (route.routeIssueSeq != null) {
    return (
      <IssueBreadcrumb
        projectKey={route.projectKey}
        projectName={projectName}
        identifier={issueIdentifier}
        parent={issueParent}
      />
    );
  }
  if (route.routeInitiativeId != null) {
    return (
      <InitiativeBreadcrumb projectKey={route.projectKey} initiativeId={route.routeInitiativeId} />
    );
  }
  if (route.routeCycleId != null) {
    return <CycleBreadcrumb projectKey={route.projectKey} cycleId={route.routeCycleId} />;
  }
  const label = pageLabel();
  if (!route.projectKey || label === projectName) return <>{label}</>;
  const project = { label: projectName, href: projectPath(route.projectKey) };
  if (route.section) {
    const first = SETTINGS_SECTIONS[0]?.slug;
    return (
      <HeaderCrumbs
        items={[
          project,
          {
            label: t('settings'),
            href: first ? settingsPath(route.projectKey, first) : undefined,
          },
          { label },
        ]}
      />
    );
  }
  return <HeaderCrumbs items={[project, { label }]} />;
}
