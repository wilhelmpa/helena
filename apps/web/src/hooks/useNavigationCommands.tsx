import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  CalendarRange,
  ShieldCheck,
  Building2,
  Code2,
  Folder,
  FolderCog,
  Inbox,
  LayoutDashboard,
  Server,
  Shield,
  SquareKanban,
  Target,
  Users,
  Workflow,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import {
  agentActivityPath,
  aiAgentsPath,
  aiTeamPath,
  dashboardsPath,
  filesPath,
  codePath,
  cyclesPath,
  godPath,
  inboxPath,
  initiativesPath,
  manageTeamsPath,
  mcpServerPath,
  membersPath,
  notesPath,
  notificationsPath,
  organizationPath,
  projectApprovalsPath,
  projectPath,
  workflowsPath,
} from '@/utils/paths';
import { HOME_NAVIGATION_ICONS, homeNavigation } from '@/components/layout/homeNavigation';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import { AI_AGENTS_SECTION, AI_TEAM_SECTIONS } from '@/utils/settingsSections';
import { GOD_SECTIONS } from '@/utils/godSections';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import {
  useAccountSectionLabel,
  useGodSectionText,
  useSettingsSectionText,
} from '@/hooks/useSectionLabels';
import type { Command, CommandSection } from '@/utils/commands';

// Every place the palette can navigate to, filtered by what the viewer may read.
// The destinations mirror the sidebar: the project nav (SidebarProjectNav) or, with no
// project open, the Home nav (homeNavigation, for `homeTeamId` like the sidebar), the
// project settings (useSettingsNavGroups, which already applies the permission gate),
// the team nav, the account pages and god mode. Grouped
// under one "Sections" heading so a search separates them from commands and
// issues.
export function useNavigationCommands(
  projectKey: string | null,
  homeTeamId: number | null = null,
): CommandSection | null {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const godText = useGodSectionText();
  const accountLabel = useAccountSectionLabel();
  const router = useRouter();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const { data: session } = useSession();
  const { groups } = useSettingsNavGroups(projectKey);
  const isGod = session?.user.role === 'god';

  const items: Command[] = [];

  function add(id: string, label: string, icon: Command['icon'], href: string, keywords?: string) {
    items.push({ id, label, icon, keywords, run: () => router.push(href) });
  }

  if (projectKey) {
    const key = projectKey;
    if (features.dashboards && can('dashboards', 'read'))
      add('nav.dashboards', t('dashboards'), <LayoutDashboard />, dashboardsPath(key), 'charts');
    add('nav.organization', t('organization'), <Building2 />, organizationPath(key), 'team goals');
    if (can('actions', 'read'))
      add('nav.workflows', t('workflows'), <Workflow />, workflowsPath(key), 'automation actions');
    add(
      'nav.work-items',
      t('workItems'),
      <SquareKanban />,
      projectPath(key),
      'board issues kanban',
    );
    add('nav.inbox', t('inbox'), <Inbox />, inboxPath(key), 'notifications unread');
    if (
      (features.documents && can('documents', 'read')) ||
      (features.notes && can('note_boards', 'read'))
    )
      add(
        'nav.files',
        t('workspace.files'),
        <Folder />,
        features.documents && can('documents', 'read') ? filesPath(key) : notesPath(key),
        'files documents notes wiki boards canvas SilverBullet',
      );
    add('nav.code', t('workspace.code'), <Code2 />, codePath(key), 'code workspace editor');
    if (features.initiatives && can('initiatives', 'read'))
      add('nav.initiatives', t('initiatives'), <Target />, initiativesPath(key), 'epics');
    if (features.cycles && can('cycles', 'read'))
      add('nav.cycles', t('cycles'), <CalendarRange />, cyclesPath(key), 'sprints iterations');
    add('nav.activity', t('agentActivity'), <Activity />, agentActivityPath(key), 'runs log');
    add(
      'nav.approvals',
      t('approvals'),
      <ShieldCheck />,
      projectApprovalsPath(key),
      'approve review',
    );
    for (const s of AI_TEAM_SECTIONS) {
      if (can(s.resource, 'read'))
        add(
          `nav.ai-team.${s.slug}`,
          sectionText(s.slug).label,
          <s.icon />,
          aiTeamPath(key, s.slug),
          'ai team',
        );
    }
    if (can(AI_AGENTS_SECTION.resource, 'read'))
      add(
        `nav.ai.${AI_AGENTS_SECTION.slug}`,
        sectionText(AI_AGENTS_SECTION.slug).label,
        <AI_AGENTS_SECTION.icon />,
        aiAgentsPath(key),
        'ai team agents',
      );
    add('nav.members', t('members'), <Users />, membersPath(key), 'team people invite');
    add(
      'nav.notifications',
      t('notificationPreferences'),
      <Bell />,
      notificationsPath(key),
      'email telegram',
    );
    // The settings destinations, already permission-filtered by the hook the
    // settings sidebar uses. The group label is a keyword so "workflow" or
    // "automation" finds its sections.
    for (const group of groups) {
      for (const item of group.items) {
        items.push({
          id: `nav.settings.${item.key}`,
          label: item.label,
          icon: <item.icon />,
          keywords: `settings ${group.label}`,
          run: () => router.push(item.href),
        });
      }
    }
    add('nav.mcp', t('mcpServer'), <Server />, mcpServerPath(key), 'model context protocol');
  } else {
    // The Home entries; Home's team settings are the project-settings entry below.
    for (const item of homeNavigation(homeTeamId, isGod)) {
      if (item.id === 'teamSettings') continue;
      const Icon = HOME_NAVIGATION_ICONS[item.id];
      add(
        `nav.home.${item.id}`,
        t(item.id),
        <Icon />,
        item.href,
        item.id === 'access'
          ? 'credentials logins google gmail mail imap smtp ssh keys connections accounts health'
          : undefined,
      );
    }
  }

  add(
    'nav.project-settings',
    t('projectSettings'),
    <FolderCog />,
    manageTeamsPath(),
    'account teams rename leave projects delete copy',
  );
  for (const s of ACCOUNT_SECTIONS) {
    add(`nav.account.${s.slug}`, accountLabel(s.slug), <s.icon />, accountPath(s.slug), 'account');
  }

  // Instance administration, owner account only. The API enforces the same, so
  // hiding it here is about noise, not access.
  if (isGod) {
    for (const s of GOD_SECTIONS) {
      add(
        `nav.god.${s.slug}`,
        t('godModeSection', { section: godText.section(s.slug).label }),
        <Shield />,
        godPath(s.slug),
        'instance admin',
      );
    }
  }

  if (items.length === 0) return null;
  return { id: 'sections', heading: t('sections'), items };
}
