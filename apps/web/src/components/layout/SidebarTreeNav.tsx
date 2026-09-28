'use client';

import { useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Bot,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Plus,
  Settings2,
  SquareTerminal,
  Target,
  Workflow,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Tree,
  TreeAction,
  TreeGap,
  TreeItem,
  pickActive,
  type NavCandidate,
} from '@/design-system';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { useAutomationStatus } from '@/hooks/useAutomationStatus';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { useOwnerInbox } from '@/features/inbox/useOwnerInbox';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import type { View } from '@/lib/api/endpoints/views';
import { useDashboardsQuery } from '@/services/dashboards.service';
import type { Project } from '@/lib/api/endpoints/projects';
import {
  agentActivityPath,
  aiAgentsPath,
  aiTeamPath,
  cyclesPath,
  dashboardPath,
  dashboardsPath,
  filesPath,
  homeFilesPath,
  inboxPath,
  initiativesPath,
  organizationPath,
  projectPath,
  receiptsPath,
  settingsPath,
  viewPath,
  workflowsPath,
} from '@/utils/paths';
import { homeNavigation } from './homeNavigation';
import SidebarApprovalsRefresh from './SidebarApprovalsRefresh';
import SidebarAreaMenu from './SidebarAreaMenu';
import SidebarSavedViewItem from './SidebarSavedViewItem';
import SidebarKnowledgeFolders from './SidebarKnowledgeFolders';
import FileNewFolderDialog from '@/features/project-files/components/FileNewFolderDialog';
import { useCrossProjectIssuesQuery } from '@/features/home/services/tasks.service';
import { useMemberRoutines, useRoutines } from '@/features/routines/services/routines.service';
import NewViewMenu from './NewViewMenu';
import { projectSettingsPages } from '@/features/settings/projectSettingsPages';
import {
  HELENA_SETTINGS,
  HELENA_SETTINGS_GROUPS,
  helenaSettingsPath,
} from '@/features/settings/settingsModalCatalog';
import type { ViewTemplate } from '@/hooks/useViewEditor';

// The sidebar tree (docs/design-system.md §6–§7, drafts ui-entwurf/Navigation-*): the
// only navigation. Labels DU and PROJEKT, no other headings; rows of one height, 16px
// indent per level, exactly one marked row — the one that describes the current page
// most specifically (nav/activeMatch) — and on level 1 an accordion: only the area that
// holds the current page is open until another is opened.

// A saved view without filters in the board or list layout shows the same as the
// "Aufgaben" row itself, so the tree does not list it a second time.
function showsAllTasks(view: View) {
  const layout = (view.display as { layout?: string } | null)?.layout ?? 'kanban';
  return (
    view.folderId == null &&
    !view.filters?.conditions?.length &&
    (layout === 'kanban' || layout === 'table')
  );
}

function useLocation() {
  const pathname = usePathname();
  const search = useSearchParams();
  return { pathname, search: new URLSearchParams(search.toString()) };
}

// The level-1 area a row id belongs to ("dashboard", "tasks", …).
const sectionOf = (id: string | null) => (id ? id.split(':')[0]! : null);

function SidebarLabel({ children }: { children: ReactNode }) {
  return (
    <span className="ds-sidebar-label" role="presentation">
      {children}
    </span>
  );
}

function OtherProjectUnread({
  project,
  pipelineCount,
}: {
  project: Project;
  pipelineCount: number;
}) {
  const t = useTranslations('nav');
  const unread = useInboxUnread(project.key, project.id).data ?? 0;
  const approvals = usePendingApprovalCount(project.key).data?.count ?? 0;
  return unread + approvals + pipelineCount > 0 ? (
    <span className="ds-other-inbox-dot" aria-label={t('sidebarOtherInbox')} />
  ) : null;
}

// Du → Inbox. In a project the count is this project's; a small dot says another project
// has something too (ui-system.md §8). In Home it counts everything.
export function SidebarInboxRow({
  teamIds,
  projectKey,
  projects,
  active,
}: {
  teamIds: number[];
  projectKey: string | null;
  projects: Project[];
  active: boolean;
}) {
  const t = useTranslations('nav');
  const pending = usePendingApprovalCount(projectKey ?? undefined).data?.count ?? 0;
  const pipelineApprovals = usePipelineApprovals().data ?? [];
  const pipelines = projectKey
    ? pipelineApprovals.filter((item) => item.projectKey === projectKey).length
    : pipelineApprovals.length;
  const project = projects.find((item) => item.key === projectKey);
  const projectUnread = useInboxUnread(project?.key ?? null, project?.id ?? null).data ?? 0;
  const { actions } = useOwnerInbox();
  const badge = projectKey ? projectUnread + pending + pipelines : actions.length;
  return (
    <>
      {teamIds.map((teamId) => (
        <SidebarApprovalsRefresh key={teamId} teamId={teamId} />
      ))}
      <TreeItem
        id="inbox"
        href={projectKey ? inboxPath(projectKey) : '/inbox'}
        label={
          <>
            {t('sidebarInbox')}
            {projectKey &&
              projects
                .filter((item) => item.key !== projectKey && item.projectRole !== 'home')
                .map((item) => (
                  <OtherProjectUnread
                    key={item.key}
                    project={item}
                    pipelineCount={
                      pipelineApprovals.filter((approval) => approval.projectKey === item.key)
                        .length
                    }
                  />
                ))}
          </>
        }
        icon={<Inbox />}
        count={badge || null}
        active={active}
      />
    </>
  );
}

// ─── Project ────────────────────────────────────────────────────────────────────────

export function SidebarProjectTree({
  projectKey,
  projects,
  teamIds,
  onNewView,
  onEditView,
  onDeleteView,
}: {
  projectKey: string;
  projects: Project[];
  teamIds: number[];
  onNewView: (template: ViewTemplate) => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
}) {
  const t = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const location = useLocation();
  const [newKnowledgeFolder, setNewKnowledgeFolder] = useState(false);
  const { can, isAdmin } = usePermissions();
  const features = useProjectFeatures();
  const automation = useAutomationStatus(projectKey);
  const { data: views = [] } = useViewsQuery(projectKey);
  const { data: areas = [] } = useViewFoldersQuery(projectKey);
  const showDashboards = features.dashboards && can('dashboards', 'read');
  const { data: dashboards = [] } = useDashboardsQuery(showDashboards ? projectKey : null);
  const showGoals = features.initiatives && can('initiatives', 'read');
  const showKnowledge =
    (features.documents && can('documents', 'read')) ||
    (features.notes && can('note_boards', 'read'));
  const showAgents = can('ai_agents', 'read');
  const schedules = useRoutines(projectKey, { page: 1, pageSize: 1 });

  const topViews = views
    .filter((view) => view.folderId == null && !showsAllTasks(view))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const viewsOf = (folderId: number) =>
    views
      .filter((view) => view.folderId === folderId)
      .sort((a, b) => a.position - b.position || a.id - b.id);

  // Settings (docs/einstellungen-struktur.md): Allgemein · Mitglieder ·
  // Benachrichtigungen, Arbeit ▸, Agenten ▸, Wissen & Belege, Mail, Integrationen ▸.
  const settingsPages = projectSettingsPages(projectKey);
  const pageLabel = (page: (typeof settingsPages)[number]) =>
    page.labelKey ? t(page.labelKey as never) : sectionText(page.slug).label;
  const settingsGroups = ['settingsWork', 'settingsAgents', 'settingsIntegrations'].map(
    (group) => ({
      id: group,
      label: t(group as never),
      items: settingsPages.filter((page) => page.group === group),
    }),
  );
  const settingsTop = settingsPages.filter((page) => !page.group);
  const settingsOrder: (
    | { kind: 'page'; page: (typeof settingsPages)[number] }
    | { kind: 'group'; group: (typeof settingsGroups)[number] }
  )[] = [];
  for (const page of settingsPages) {
    if (!page.group) settingsOrder.push({ kind: 'page', page });
    else if (
      !settingsOrder.some((entry) => entry.kind === 'group' && entry.group.id === page.group)
    )
      settingsOrder.push({
        kind: 'group',
        group: settingsGroups.find((group) => group.id === page.group)!,
      });
  }

  // Every row the tree can mark, with the pages it stands for.
  const candidates: NavCandidate[] = [
    { id: 'inbox', href: inboxPath(projectKey), also: [`${projectPath(projectKey)}/approvals`] },
    ...(showDashboards
      ? [
          { id: 'dashboard', href: dashboardsPath(projectKey), exact: true },
          ...dashboards.map((dashboard) => ({
            id: `dashboard:${dashboard.id}`,
            href: dashboardPath(projectKey, dashboard.id),
          })),
        ]
      : []),
    {
      id: 'tasks',
      href: projectPath(projectKey),
      exact: true,
      also: [`${projectPath(projectKey)}/issue`, cyclesPath(projectKey)],
    },
    ...views.map((view) => ({ id: `tasks:view:${view.id}`, href: viewPath(projectKey, view.id) })),
    ...(showGoals ? [{ id: 'goals', href: initiativesPath(projectKey) }] : []),
    ...(showKnowledge
      ? [
          {
            id: 'knowledge',
            href: filesPath(projectKey),
            without: ['path', 'file'],
            also: [`${projectPath(projectKey)}/docs`, `${projectPath(projectKey)}/notes`],
          },
          ...(isAdmin ? [{ id: 'knowledge:receipts', href: receiptsPath(projectKey) }] : []),
        ]
      : []),
    ...(showAgents
      ? [
          {
            id: 'automation:team',
            href: organizationPath(projectKey),
            also: [aiAgentsPath(projectKey), `${projectPath(projectKey)}/chat`],
          },
          { id: 'automation:schedules', href: aiTeamPath(projectKey, 'schedules') },
          { id: 'automation:workflows', href: workflowsPath(projectKey) },
        ]
      : []),
    { id: 'automation:history', href: agentActivityPath(projectKey) },
    ...settingsTop.map((item) => ({ id: `settings:${item.slug}`, href: item.href })),
    ...settingsGroups.flatMap((group) =>
      group.items.map((item) => ({ id: `settings:${group.id}:${item.slug}`, href: item.href })),
    ),
    { id: 'settings:general', href: settingsPath(projectKey, 'danger-zone') },
    { id: 'settings:settingsAgents:autopilot', href: settingsPath(projectKey, 'budgets') },
  ];
  // A file of a folder: the folder row marks itself (SidebarKnowledgeFolders).
  const folderOpen = location.pathname === filesPath(projectKey) && location.search.has('path');
  const activeId = pickActive(candidates, location);
  const activeSection = folderOpen ? 'knowledge' : sectionOf(activeId);
  const is = (id: string) => activeId === id;
  const within = (prefix: string) => activeId?.startsWith(prefix) ?? false;

  return (
    <Tree label={t('sidebarProject')} activeSection={activeSection}>
      <SidebarLabel>{t('sidebarYou')}</SidebarLabel>
      <SidebarInboxRow
        teamIds={teamIds}
        projectKey={projectKey}
        projects={projects}
        active={is('inbox')}
      />
      <SidebarLabel>{t('sidebarProject')}</SidebarLabel>
      {showDashboards && (
        <TreeItem
          id="dashboard"
          label={t('dashboards')}
          href={dashboardsPath(projectKey)}
          icon={<LayoutDashboard />}
          active={is('dashboard')}
          actions={
            can('dashboards', 'create') && (
              <TreeAction
                label={t('sidebarNewDashboard')}
                href={`${dashboardsPath(projectKey)}?create=dashboard`}
              >
                <Plus />
              </TreeAction>
            )
          }
        >
          {dashboards.length > 0
            ? dashboards.map((dashboard) => (
                <TreeItem
                  key={dashboard.id}
                  label={dashboard.name}
                  href={dashboardPath(projectKey, dashboard.id)}
                  active={is(`dashboard:${dashboard.id}`)}
                />
              ))
            : null}
        </TreeItem>
      )}
      <TreeItem
        id="tasks"
        label={t('workItems')}
        href={projectPath(projectKey)}
        icon={<ListTodo />}
        active={is('tasks')}
        actions={
          can('views', 'create') && <NewViewMenu projectKey={projectKey} onSelect={onNewView} />
        }
      >
        {topViews.length > 0 || areas.length > 0 ? (
          <>
            {topViews.map((view) => (
              <SidebarSavedViewItem
                key={view.id}
                view={view}
                views={views}
                folders={areas}
                projectKey={projectKey}
                active={is(`tasks:view:${view.id}`)}
                onEdit={onEditView}
                onDelete={onDeleteView}
              />
            ))}
            {can('views', 'read') &&
              areas.map((area) => (
                <TreeItem
                  key={area.id}
                  label={area.name}
                  storageKey={`${projectKey}:area:${area.id}`}
                  containsActive={viewsOf(area.id).some((view) => is(`tasks:view:${view.id}`))}
                  actions={<SidebarAreaMenu projectKey={projectKey} area={area} areas={areas} />}
                >
                  {viewsOf(area.id).length > 0
                    ? viewsOf(area.id).map((view) => (
                        <SidebarSavedViewItem
                          key={view.id}
                          view={view}
                          views={views}
                          folders={areas}
                          projectKey={projectKey}
                          active={is(`tasks:view:${view.id}`)}
                          onEdit={onEditView}
                          onDelete={onDeleteView}
                        />
                      ))
                    : null}
                </TreeItem>
              ))}
          </>
        ) : null}
      </TreeItem>
      {showGoals && (
        <TreeItem
          id="goals"
          label={t('sidebarGoals')}
          href={initiativesPath(projectKey)}
          icon={<Target />}
          active={is('goals')}
        />
      )}
      {showKnowledge && (
        <TreeItem
          id="knowledge"
          label={isAdmin ? t('sidebarKnowledgeReceipts') : t('sidebarKnowledge')}
          href={filesPath(projectKey)}
          icon={<FolderOpen />}
          active={is('knowledge')}
          actions={
            can('documents', 'create') && (
              <TreeAction label={t('sidebarNewFolder')} onClick={() => setNewKnowledgeFolder(true)}>
                <Plus />
              </TreeAction>
            )
          }
        >
          <SidebarKnowledgeFolders
            scope={{ kind: 'project', projectKey, root: 'vault' }}
            canWrite={can('documents', 'edit')}
          />
          {isAdmin && (
            <TreeItem
              label={t('receipts')}
              href={receiptsPath(projectKey)}
              active={is('knowledge:receipts')}
            />
          )}
        </TreeItem>
      )}
      {newKnowledgeFolder && (
        <FileNewFolderDialog
          scope={{ kind: 'project', projectKey, root: 'vault' }}
          folder=""
          onClose={() => setNewKnowledgeFolder(false)}
        />
      )}
      <TreeItem
        id="automation"
        label={t('sidebarAutomation')}
        icon={<Bot />}
        dot={automation}
        actions={
          can('ai_agents', 'create') && (
            <TreeAction
              label={t('sidebarNewSchedule')}
              href={`${aiTeamPath(projectKey, 'schedules')}?create=schedule`}
            >
              <Plus />
            </TreeAction>
          )
        }
      >
        {showAgents && (
          <>
            <TreeItem
              label={t('sidebarTeam')}
              href={organizationPath(projectKey)}
              active={is('automation:team')}
              dot={automation}
            />
            <TreeItem
              label={t('sidebarSchedules')}
              href={aiTeamPath(projectKey, 'schedules')}
              active={is('automation:schedules')}
              count={schedules.data?.total || null}
            />
            <TreeItem
              label={t('workflows')}
              href={workflowsPath(projectKey)}
              active={is('automation:workflows')}
            />
          </>
        )}
        <TreeItem
          label={t('sidebarHistory')}
          href={agentActivityPath(projectKey)}
          active={is('automation:history')}
        />
      </TreeItem>
      <TreeItem id="settings" label={t('settings')} icon={<Settings2 />}>
        {settingsOrder.map((entry) =>
          entry.kind === 'page' ? (
            <TreeItem
              key={entry.page.slug}
              label={pageLabel(entry.page)}
              href={entry.page.href}
              active={is(`settings:${entry.page.slug}`)}
            />
          ) : (
            <TreeItem
              key={entry.group.id}
              label={entry.group.label}
              storageKey={`${projectKey}:settings:${entry.group.id}`}
              defaultOpen={false}
              containsActive={within(`settings:${entry.group.id}:`)}
            >
              {entry.group.items.map((item) => (
                <TreeItem
                  key={item.slug}
                  label={pageLabel(item)}
                  href={item.href}
                  active={is(`settings:${entry.group.id}:${item.slug}`)}
                />
              ))}
            </TreeItem>
          ),
        )}
      </TreeItem>
    </Tree>
  );
}

// ─── Home ───────────────────────────────────────────────────────────────────────────

export function SidebarHomeTree({
  teamId,
  isGod,
  teamIds,
  projects,
}: {
  teamId: number | null;
  isGod: boolean;
  teamIds: number[];
  projects: Project[];
}) {
  const t = useTranslations('nav');
  const tSettings = useTranslations('settings.modal');
  const owner = isGod;
  const home = homeNavigation(teamId);
  const get = (id: string) => home.find((item) => item.id === id)?.href;
  const [newFolder, setNewFolder] = useState(false);
  const location = useLocation();
  const automation = useAutomationStatus(null);
  const myTasksCount = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { stateType: 'open', assignee: 'me' },
  );
  const openTasksCount = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { stateType: 'open' },
  );
  const schedulesCount = useMemberRoutines({ page: 1, pageSize: 1 });
  const roots = owner ? (['home', 'private', 'templates'] as const) : (['templates'] as const);
  const rootHref = (root: (typeof roots)[number]) => homeFilesPath('', { root });
  const currentRoot = location.search.get('root') ?? (owner ? 'home' : 'templates');
  const teamHref = get('organization') ?? '/organization';

  const candidates: NavCandidate[] = [
    { id: 'inbox', href: '/inbox', also: ['/approvals', '/mail'] },
    { id: 'dashboard', href: '/', exact: true },
    { id: 'dashboard:all', href: '/dashboard' },
    ...(isGod ? [{ id: 'dashboard:system', href: '/system' }] : []),
    { id: 'tasks:open', href: '/tasks', without: ['assignee'], also: ['/issue'] },
    { id: 'tasks:mine', href: '/tasks?assignee=me' },
    { id: 'goals', href: '/organization?tab=goals' },
    { id: 'knowledge', href: '/files', without: ['root', 'path', 'file'], also: ['/docs'] },
    ...roots.map((root) => ({
      id: `knowledge:${root}`,
      href: `/files?root=${root}`,
      without: ['path'],
    })),
    { id: 'automation:team', href: teamHref, without: ['tab'] },
    { id: 'automation:pool', href: '/agents' },
    { id: 'automation:schedules', href: '/schedules' },
    { id: 'automation:workflows', href: '/workflows' },
    { id: 'automation:history', href: '/activity', also: ['/browsers'] },
    ...(owner ? [{ id: 'terminals', href: '/terminals' }] : []),
    ...(owner
      ? HELENA_SETTINGS.map((item) => ({
          id: `settings:${item.group}:${item.slug}`,
          href: helenaSettingsPath(item.slug),
        }))
      : []),
  ];
  const folderOpen = location.pathname === '/files' && location.search.has('path');
  let activeId = pickActive(candidates, location);
  // /files without a root is the root the user sees first.
  if (activeId === 'knowledge' && roots.length > 0) activeId = `knowledge:${currentRoot}`;
  // Helena's own knowledge is "Wissen" itself; Privat and Vorlagen are its children.
  if (activeId === 'knowledge:home') activeId = 'knowledge';
  const activeSection = folderOpen ? 'knowledge' : sectionOf(activeId);
  const is = (id: string) => activeId === id;
  const within = (prefix: string) => activeId?.startsWith(prefix) ?? false;
  const settingLabel = (slug: string) => tSettings(`sections.${slug}.label` as never);

  return (
    <Tree label={t('sidebarProject')} activeSection={activeSection}>
      <SidebarLabel>{t('sidebarYou')}</SidebarLabel>
      <SidebarInboxRow
        teamIds={teamIds}
        projectKey={null}
        projects={projects}
        active={is('inbox')}
      />
      <SidebarLabel>{t('sidebarProject')}</SidebarLabel>
      <TreeItem
        id="dashboard"
        label={t('dashboards')}
        href="/"
        icon={<LayoutDashboard />}
        active={is('dashboard')}
      >
        <TreeItem label={t('sidebarAllProjects')} href="/dashboard" active={is('dashboard:all')} />
        {isGod && (
          <TreeItem label={t('sidebarSystem')} href="/system" active={is('dashboard:system')} />
        )}
      </TreeItem>
      <TreeItem id="tasks" label={t('workItems')} href="/tasks" icon={<ListTodo />}>
        <TreeItem
          label={t('sidebarMyTasks')}
          href="/tasks?assignee=me"
          active={is('tasks:mine')}
          count={myTasksCount.data?.total || null}
        />
        <TreeItem
          label={t('sidebarOpenTasks')}
          href="/tasks"
          active={is('tasks:open')}
          count={openTasksCount.data?.total || null}
        />
      </TreeItem>
      <TreeItem
        id="goals"
        label={t('sidebarGoals')}
        href="/organization?tab=goals"
        icon={<Target />}
        active={is('goals')}
      />
      <TreeItem
        id="knowledge"
        label={t('sidebarKnowledge')}
        href={rootHref(roots[0])}
        icon={<FolderOpen />}
        active={is('knowledge')}
        actions={
          owner && (
            <TreeAction label={t('sidebarNewFolder')} onClick={() => setNewFolder(true)}>
              <Plus />
            </TreeAction>
          )
        }
      >
        {owner && <SidebarKnowledgeFolders scope={{ kind: 'home', root: 'home' }} canWrite />}
        {roots
          .filter((root) => root !== 'home')
          .map((root) => (
            <TreeItem
              key={root}
              label={t(root === 'private' ? 'sidebarPrivate' : 'sidebarTemplates')}
              href={rootHref(root)}
              active={is(`knowledge:${root}`)}
              containsActive={folderOpen && currentRoot === root}
              storageKey={`home:knowledge:${root}`}
            >
              <SidebarKnowledgeFolders scope={{ kind: 'home', root }} canWrite={owner} />
            </TreeItem>
          ))}
      </TreeItem>
      {newFolder && (
        <FileNewFolderDialog
          scope={{
            kind: 'home',
            root: currentRoot === 'private' || currentRoot === 'templates' ? currentRoot : 'home',
          }}
          folder=""
          onClose={() => setNewFolder(false)}
        />
      )}
      <TreeItem id="automation" label={t('sidebarAutomation')} icon={<Workflow />} dot={automation}>
        <TreeItem
          label={t('sidebarTeam')}
          href={teamHref}
          active={is('automation:team')}
          dot={automation}
        />
        <TreeItem label={t('sidebarAgentPool')} href="/agents" active={is('automation:pool')} />
        <TreeItem
          label={t('sidebarSchedules')}
          href="/schedules"
          active={is('automation:schedules')}
          count={schedulesCount.data?.total || null}
        />
        <TreeItem label={t('workflows')} href="/workflows" active={is('automation:workflows')} />
        <TreeItem label={t('sidebarHistory')} href="/activity" active={is('automation:history')} />
      </TreeItem>
      {owner && (
        <TreeItem
          id="terminals"
          label={t('sidebarTerminals')}
          href="/terminals"
          icon={<SquareTerminal />}
          active={is('terminals')}
        />
      )}
      {owner && (
        <TreeItem id="settings" label={t('settings')} icon={<Settings2 />}>
          {HELENA_SETTINGS_GROUPS.map((group) => (
            <TreeItem
              key={group}
              label={tSettings(`groups.${group}` as never)}
              storageKey={`helena:settings:${group}`}
              containsActive={within(`settings:${group}:`)}
            >
              {HELENA_SETTINGS.filter((item) => item.group === group).map((item) => (
                <TreeItem
                  key={item.slug}
                  label={settingLabel(item.slug)}
                  href={helenaSettingsPath(item.slug)}
                  active={is(`settings:${group}:${item.slug}`)}
                />
              ))}
            </TreeItem>
          ))}
        </TreeItem>
      )}
    </Tree>
  );
}

export { TreeGap };
