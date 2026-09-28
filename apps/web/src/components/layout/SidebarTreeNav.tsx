'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { useInboxUnread } from '@/hooks/useInboxUnread';
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
  dashboardPath,
  dashboardsPath,
  filesPath,
  homeFilesPath,
  inboxPath,
  initiativesPath,
  cyclesPath,
  receiptsPath,
  projectPath,
  workflowsPath,
  organizationPath,
} from '@/utils/paths';
import { homeNavigation } from './homeNavigation';
import SidebarApprovalsRefresh from './SidebarApprovalsRefresh';
import SidebarAreaNav from './SidebarAreaNav';
import SidebarSavedViewItem from './SidebarSavedViewItem';
import { hasTreeContent } from './treeContent';
import SidebarKnowledgeFolders from './SidebarKnowledgeFolders';
import FileNewFolderDialog from '@/features/project-files/components/FileNewFolderDialog';
import { useState } from 'react';
import { useCrossProjectIssuesQuery } from '@/features/home/services/tasks.service';
import { useMemberRoutines } from '@/features/routines/services/routines.service';
import NewViewMenu from './NewViewMenu';
import type { ViewTemplate } from '@/hooks/useViewEditor';

function pathIsActive(pathname: string, href: string) {
  const path = href.split('?')[0]!;
  if (/^\/project\/[^/]+$/.test(path)) {
    return (
      pathname === path ||
      pathname.startsWith(`${path}/view/`) ||
      pathname.startsWith(`${path}/issue/`)
    );
  }
  return pathname === path || (path !== '/' && pathname.startsWith(`${path}/`));
}

function TreeLink({
  href,
  children,
  badge,
  dot,
  nested = false,
  activeOverride,
}: {
  href: string;
  children: ReactNode;
  badge?: number;
  dot?: boolean;
  nested?: boolean;
  activeOverride?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [path, query] = href.split('?');
  const active =
    activeOverride ??
    (query
      ? pathname === path &&
        [...new URLSearchParams(query)].every(([key, value]) => searchParams.get(key) === value)
      : path === '/tasks'
        ? pathname === path && !searchParams.has('assignee') && !searchParams.has('state')
        : pathIsActive(pathname, href) && (!nested || searchParams.size === 0));
  return (
    <Link
      href={href}
      className={`helena-tree-link ${nested ? 'helena-tree-child' : ''} ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge != null && badge > 0 && <span className="helena-tree-badge">{badge}</span>}
      {dot && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
    </Link>
  );
}

function TreeBranch({
  id,
  label,
  href,
  action,
  hasChildren,
  activePaths = [],
  defaultOpen = false,
  activeOverride,
  children,
}: {
  id: string;
  label: string;
  href: string;
  action?: ReactNode;
  hasChildren?: boolean;
  activePaths?: string[];
  defaultOpen?: boolean;
  activeOverride?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = usePersistedBoolean(
    `sidebar:tree:${id}`,
    defaultOpen ||
      pathIsActive(pathname, href) ||
      activePaths.some((path) => pathIsActive(pathname, path)),
  );
  const expandable = hasChildren ?? hasTreeContent(children);
  return (
    <div className="helena-tree-branch">
      <div className="helena-tree-parent">
        <TreeLink href={href} activeOverride={activeOverride}>
          {label}
        </TreeLink>
        {action}
        {expandable && (
          <button
            type="button"
            className="helena-tree-toggle"
            aria-label={label}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={14} className={open ? 'rotate-90' : ''} />
          </button>
        )}
      </div>
      {expandable && open && <div className="helena-tree-children">{children}</div>}
    </div>
  );
}

function OtherProjectUnread({
  project,
  pipelineCount,
}: {
  project: Project;
  pipelineCount: number;
}) {
  const unread = useInboxUnread(project.key, project.id).data ?? 0;
  const approvals = usePendingApprovalCount(project.key).data?.count ?? 0;
  return unread + approvals + pipelineCount > 0 ? (
    <span className="helena-other-inbox-dot" aria-label="Andere Projekte haben neue Einträge" />
  ) : null;
}

function ApprovalBadge({
  teamIds,
  projectKey,
  projects,
}: {
  teamIds: number[];
  projectKey: string | null;
  projects: Project[];
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
      <TreeBranch
        id="you:inbox"
        label={t('sidebarInbox')}
        href={projectKey ? inboxPath(projectKey) : '/inbox'}
        hasChildren={false}
        action={
          <>
            {badge > 0 && <span className="helena-tree-badge">{badge}</span>}
            {projectKey &&
              projects
                .filter((item) => item.key !== projectKey)
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
      >
        {null}
      </TreeBranch>
    </>
  );
}

export function SidebarPersonalNav({
  teamIds,
  projectKey,
  projects,
}: {
  teamIds: number[];
  projectKey: string | null;
  projects: Project[];
}) {
  const t = useTranslations('nav');
  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarYou')}</h2>
      <ApprovalBadge teamIds={teamIds} projectKey={projectKey} projects={projects} />
    </section>
  );
}

export function SidebarHomeTree({ teamId, isGod }: { teamId: number | null; isGod: boolean }) {
  const t = useTranslations('nav');
  const owner = isGod;
  const home = homeNavigation(teamId);
  const get = (id: string) => home.find((item) => item.id === id)?.href;
  const [newFolder, setNewFolder] = useState(false);
  const params = useSearchParams();
  const homeRoot = params.get('root');
  const homePath = params.get('path');
  const homePathname = usePathname();
  const tasksCount = useCrossProjectIssuesQuery({ page: 1, pageSize: 1 }, { stateType: 'open' });
  const myTasksCount = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { stateType: 'open', assignee: 'me' },
  );
  const schedulesCount = useMemberRoutines({ page: 1, pageSize: 1 });
  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarProject')}</h2>
      <TreeBranch
        id="home:dashboard"
        label={t('dashboards')}
        href="/"
        activePaths={['/system']}
        defaultOpen
      >
        <TreeLink href="/dashboard" nested>
          {t('sidebarAllProjects')}
        </TreeLink>
        {isGod && (
          <TreeLink href="/system" nested>
            {t('sidebarSystem')}
          </TreeLink>
        )}
      </TreeBranch>
      <TreeBranch
        id="home:tasks"
        label={t('workItems')}
        href="/tasks"
        defaultOpen
        action={
          tasksCount.data?.total ? (
            <span className="helena-tree-badge">{tasksCount.data.total}</span>
          ) : undefined
        }
      >
        <TreeLink href="/tasks?assignee=me" nested badge={myTasksCount.data?.total}>
          {t('sidebarMyTasks')}
        </TreeLink>
        <TreeLink href="/tasks" nested>
          {t('sidebarOpenTasks')}
        </TreeLink>
      </TreeBranch>
      <TreeBranch
        id="home:files"
        label={t('sidebarKnowledge')}
        href="/files"
        activePaths={['/docs']}
        defaultOpen
        action={
          owner && (
            <button
              type="button"
              className="helena-tree-toggle knowledge-folder-add"
              aria-label="Ordner in Home anlegen"
              onClick={() => setNewFolder(true)}
            >
              <Plus size={14} />
            </button>
          )
        }
      >
        {(owner ? (['home', 'private', 'templates'] as const) : (['templates'] as const)).map(
          (root) => (
            <div key={root}>
              <TreeLink
                href={homeFilesPath('', { root })}
                nested
                activeOverride={
                  homePathname === '/files' &&
                  (homeRoot ?? (owner ? 'home' : 'templates')) === root &&
                  !homePath
                }
              >
                {t(
                  root === 'home'
                    ? 'sidebarHome'
                    : root === 'private'
                      ? 'sidebarPrivate'
                      : 'sidebarTemplates',
                )}
              </TreeLink>
            </div>
          ),
        )}
      </TreeBranch>
      {newFolder && (
        <FileNewFolderDialog
          scope={{
            kind: 'home',
            root: homeRoot === 'private' || homeRoot === 'templates' ? homeRoot : 'home',
          }}
          folder=""
          onClose={() => setNewFolder(false)}
        />
      )}
      <TreeBranch
        id="home:auto"
        label={t('sidebarAutomation')}
        href={get('organization') ?? '/agents'}
        activePaths={['/agents', '/schedules', '/activity', '/workflows', '/browsers']}
        defaultOpen
      >
        <TreeLink href={get('organization') ?? '/organization'} nested>
          {t('sidebarTeamDeciders')}
        </TreeLink>
        <TreeLink href="/schedules" nested badge={schedulesCount.data?.total}>
          {t('sidebarSchedules')}
        </TreeLink>
        <TreeLink href="/activity" nested>
          {t('sidebarHistory')}
        </TreeLink>
      </TreeBranch>
    </section>
  );
}

export function SidebarProjectTree({
  projectKey,
  onNewView,
  onEditView,
  onDeleteView,
}: {
  projectKey: string;
  onNewView: (template: ViewTemplate) => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
}) {
  const t = useTranslations('nav');
  const [newKnowledgeFolder, setNewKnowledgeFolder] = useState(false);
  const pathname = usePathname();
  const knowledgePath = useSearchParams().get('path');
  const { can, isAdmin } = usePermissions();
  const features = useProjectFeatures();
  const { data: views = [] } = useViewsQuery(projectKey);
  const { data: areas = [] } = useViewFoldersQuery(projectKey);
  const { data: dashboards = [] } = useDashboardsQuery(
    features.dashboards && can('dashboards', 'read') ? projectKey : null,
  );
  const taskHref = projectPath(projectKey);

  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarProject')}</h2>
      {features.dashboards && can('dashboards', 'read') && (
        <TreeBranch
          id={`${projectKey}:dashboard`}
          label={t('dashboards')}
          href={dashboardsPath(projectKey)}
          hasChildren={
            dashboards.length > 0 || (features.initiatives && can('initiatives', 'read'))
          }
          activePaths={[initiativesPath(projectKey)]}
          action={
            can('dashboards', 'create') && (
              <Link
                href={`${dashboardsPath(projectKey)}?create=dashboard`}
                className="helena-tree-toggle helena-tree-create"
                aria-label="Neues Dashboard"
                title="Neues Dashboard"
              >
                <Plus size={14} />
              </Link>
            )
          }
        >
          {features.initiatives && can('initiatives', 'read') && (
            <TreeLink href={initiativesPath(projectKey)} nested>
              {'Ziele'}
            </TreeLink>
          )}
          {dashboards.map((dashboard) => (
            <TreeLink key={dashboard.id} href={dashboardPath(projectKey, dashboard.id)} nested>
              {dashboard.name}
            </TreeLink>
          ))}
        </TreeBranch>
      )}
      <TreeBranch
        id={`${projectKey}:tasks`}
        label={t('workItems')}
        href={taskHref}
        activePaths={[cyclesPath(projectKey)]}
        hasChildren={views.length > 0 || (can('views', 'read') && areas.length > 0)}
        action={can('views', 'create') && <NewViewMenu onSelect={onNewView} />}
      >
        {views
          .filter((view) => view.folderId == null)
          .sort((a, b) => a.position - b.position || a.id - b.id)
          .map((view) => (
            <SidebarSavedViewItem
              key={view.id}
              view={view}
              views={views}
              folders={areas}
              projectKey={projectKey}
              onEdit={onEditView}
              onDelete={onDeleteView}
            />
          ))}
        {can('views', 'read') && (areas.length > 0 || can('views', 'create')) && (
          <SidebarAreaNav
            projectKey={projectKey}
            onEditView={onEditView}
            onDeleteView={onDeleteView}
          />
        )}
      </TreeBranch>
      {((features.documents && can('documents', 'read')) ||
        (features.notes && can('note_boards', 'read'))) && (
        <TreeBranch
          id={`${projectKey}:files`}
          label={isAdmin ? `${t('sidebarKnowledge')} & ${t('receipts')}` : t('sidebarKnowledge')}
          href={filesPath(projectKey)}
          activePaths={isAdmin ? [receiptsPath(projectKey)] : []}
          activeOverride={pathname === filesPath(projectKey) && !knowledgePath}
          action={
            can('documents', 'create') && (
              <button
                type="button"
                className="helena-tree-toggle knowledge-folder-add"
                aria-label="Ordner in Wissen anlegen"
                onClick={() => setNewKnowledgeFolder(true)}
              >
                <Plus size={14} />
              </button>
            )
          }
        >
          <SidebarKnowledgeFolders
            scope={{ kind: 'project', projectKey, root: 'vault' }}
            canWrite={can('documents', 'edit')}
          />
          {isAdmin && (
            <TreeLink href={receiptsPath(projectKey)} nested>
              {t('receipts')}
            </TreeLink>
          )}
        </TreeBranch>
      )}
      {newKnowledgeFolder && (
        <FileNewFolderDialog
          scope={{ kind: 'project', projectKey, root: 'vault' }}
          folder=""
          onClose={() => setNewKnowledgeFolder(false)}
        />
      )}
      <TreeBranch
        id={`${projectKey}:auto`}
        label={t('sidebarAutomation')}
        href={can('ai_agents', 'read') ? aiAgentsPath(projectKey) : agentActivityPath(projectKey)}
        hasChildren={can('ai_agents', 'read')}
        action={
          can('ai_agents', 'create') && (
            <Link
              href={`${aiTeamPath(projectKey, 'schedules')}?create=schedule`}
              className="helena-tree-toggle helena-tree-create"
              aria-label="Neuer Zeitplan"
              title="Neuer Zeitplan"
            >
              <Plus size={14} />
            </Link>
          )
        }
        activePaths={[
          organizationPath(projectKey),
          aiTeamPath(projectKey, 'schedules'),
          agentActivityPath(projectKey),
          workflowsPath(projectKey),
        ]}
      >
        {can('ai_agents', 'read') && (
          <>
            <TreeLink href={aiAgentsPath(projectKey)} nested>
              {t('sidebarTeamDeciders')}
            </TreeLink>
            <TreeLink href={aiTeamPath(projectKey, 'schedules')} nested>
              {t('sidebarSchedules')}
            </TreeLink>
            <TreeLink href={organizationPath(projectKey)} nested>
              {t('teamOrchestration')}
            </TreeLink>
          </>
        )}
        {can('ai_agents', 'read') && (
          <TreeLink href={agentActivityPath(projectKey)} nested>
            {t('sidebarHistory')}
          </TreeLink>
        )}
      </TreeBranch>
    </section>
  );
}
