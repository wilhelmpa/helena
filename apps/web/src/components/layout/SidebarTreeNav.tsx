'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronRight, Folder, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { useProjectSettingsNavItems } from '@/hooks/useProjectSettingsNavItems';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import type { View } from '@/lib/api/endpoints/views';
import { useFilesQuery } from '@/services/files.service';
import { useDashboardsQuery } from '@/services/dashboards.service';
import { useProjectMailAccounts } from '@/services/mail.service';
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
  projectPath,
  receiptsPath,
  workflowsPath,
  projectApprovalsPath,
  organizationPath,
} from '@/utils/paths';
import { homeNavigation } from './homeNavigation';
import SidebarApprovalsRefresh from './SidebarApprovalsRefresh';
import SidebarAreaNav from './SidebarAreaNav';
import SidebarSavedViewItem from './SidebarSavedViewItem';

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
  nested = false,
  activeOverride,
}: {
  href: string;
  children: ReactNode;
  badge?: number;
  nested?: boolean;
  activeOverride?: boolean;
}) {
  const pathname = usePathname();
  const active = activeOverride ?? (!href.includes('?') && pathIsActive(pathname, href));
  return (
    <Link
      href={href}
      className={`helena-tree-link ${nested ? 'helena-tree-child' : ''} ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge != null && badge > 0 && <span className="helena-tree-badge">{badge}</span>}
    </Link>
  );
}

function TreeBranch({
  id,
  label,
  href,
  action,
  activePaths = [],
  children,
}: {
  id: string;
  label: string;
  href: string;
  action?: ReactNode;
  activePaths?: string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = usePersistedBoolean(
    `sidebar:tree:${id}`,
    pathIsActive(pathname, href) || activePaths.some((path) => pathIsActive(pathname, path)),
  );
  return (
    <div className="helena-tree-branch">
      <div className="helena-tree-parent">
        <TreeLink href={href}>{label}</TreeLink>
        {action}
        <button
          type="button"
          className="helena-tree-toggle"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className={open ? 'rotate-90' : ''} />
        </button>
      </div>
      {open && <div className="helena-tree-children">{children}</div>}
    </div>
  );
}

function ApprovalBadge({ teamIds }: { teamIds: number[] }) {
  const t = useTranslations('nav');
  const pending = usePendingApprovalCount().data?.count ?? 0;
  const pipelines = usePipelineApprovals().data?.length ?? 0;
  const proposals = useProposalCount().data?.count ?? 0;
  return (
    <>
      {teamIds.map((teamId) => (
        <SidebarApprovalsRefresh key={teamId} teamId={teamId} />
      ))}
      <TreeBranch
        id="you:inbox"
        label={t('sidebarInbox')}
        href="/inbox"
        activePaths={['/approvals']}
        action={
          pending + pipelines + proposals > 0 && (
            <span className="helena-tree-badge">{pending + pipelines + proposals}</span>
          )
        }
      >
        <TreeLink href="/approvals" nested>
          {t('approvals')}
        </TreeLink>
      </TreeBranch>
    </>
  );
}

export function SidebarPersonalNav({ teamIds }: { teamIds: number[] }) {
  const t = useTranslations('nav');
  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarYou')}</h2>
      <TreeLink href="/chat">{t('sidebarHomeChat')}</TreeLink>
      <ApprovalBadge teamIds={teamIds} />
    </section>
  );
}

export function SidebarHomeTree({ teamId }: { teamId: number | null }) {
  const t = useTranslations('nav');
  const home = homeNavigation(teamId);
  const get = (id: string) => home.find((item) => item.id === id)?.href;
  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarProject')}</h2>
      <TreeBranch id="home:tasks" label={t('workItems')} href="/tasks">
        <TreeLink href="/tasks?assignee=me" nested>
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
      >
        <TreeLink href="/docs" nested>
          {t('docs')}
        </TreeLink>
        <TreeLink href={homeFilesPath('', { root: 'home' })} nested>
          {t('sidebarHome')}
        </TreeLink>
        <TreeLink href={homeFilesPath('', { root: 'private' })} nested>
          {t('sidebarPrivate')}
        </TreeLink>
        <TreeLink href={homeFilesPath('', { root: 'templates' })} nested>
          {t('sidebarTemplates')}
        </TreeLink>
      </TreeBranch>
      <TreeLink href="/">{t('dashboards')}</TreeLink>
      <TreeBranch
        id="home:auto"
        label={t('sidebarAutomation')}
        href={get('organization') ?? '/agents'}
        activePaths={['/agents', '/schedules', '/activity', '/workflows', '/browsers']}
      >
        <TreeLink href={get('organization') ?? '/organization'} nested>
          {t('sidebarTeamDeciders')}
        </TreeLink>
        <TreeLink href={get('agentPool') ?? '/agents'} nested>
          {t('aiAgents')}
        </TreeLink>
        <TreeLink href="/schedules" nested>
          {t('sidebarSchedules')}
        </TreeLink>
        <TreeLink href="/activity" nested>
          {t('sidebarHistory')}
        </TreeLink>
        <TreeLink href={get('workflows') ?? '/workflows'} nested>
          {t('workflows')}
        </TreeLink>
        {get('browser') && (
          <TreeLink href={get('browser')!} nested>
            {t('workspace.browser')}
          </TreeLink>
        )}
      </TreeBranch>
      <TreeBranch
        id="home:settings"
        label={t('settings')}
        href={get('teamSettings') ?? '/account/preferences'}
        activePaths={['/skills', '/tools', '/mcps', '/access', '/decisions', '/devices']}
      >
        {home
          .filter((item) => item.group === 'globalSettings')
          .map((item) => (
            <TreeLink key={item.id} href={item.href} nested>
              {t(item.id)}
            </TreeLink>
          ))}
        {teamId == null && (
          <>
            <TreeLink href="/skills" nested>
              {t('skills')}
            </TreeLink>
            <TreeLink href="/tools" nested>
              {t('tools')}
            </TreeLink>
            <TreeLink href="/mcps" nested>
              {t('mcps')}
            </TreeLink>
            <TreeLink href="/decisions" nested>
              {t('decisions')}
            </TreeLink>
            <TreeLink href="/account/teams" nested>
              {t('teamSettings')}
            </TreeLink>
          </>
        )}
        <TreeLink href="/inbox" nested>
          {t('inbox')}
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
  onNewView: () => void;
  onEditView: (view: View) => void;
  onDeleteView: (view: View) => Promise<void>;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeKnowledgeFolder =
    pathname === filesPath(projectKey) ? searchParams.get('path')?.split('/')[0] : null;
  const viewsT = useTranslations('views');
  const { can, isAdmin } = usePermissions();
  const features = useProjectFeatures();
  const { data: views = [] } = useViewsQuery(projectKey);
  const { data: areas = [] } = useViewFoldersQuery(projectKey);
  const { data: folders } = useFilesQuery(
    { kind: 'project', projectKey, root: 'vault' },
    '',
    features.documents && can('documents', 'read'),
  );
  const { data: dashboards = [] } = useDashboardsQuery(
    features.dashboards && can('dashboards', 'read') ? projectKey : null,
  );
  const { data: mailAccounts = [] } = useProjectMailAccounts(projectKey);
  const settings = useProjectSettingsNavItems(projectKey);
  const first = settings.find((item) => item.key === 'general') ?? settings[0];
  const taskHref = projectPath(projectKey);

  return (
    <section className="helena-sidebar-section">
      <h2>{t('sidebarProject')}</h2>
      <TreeBranch
        id={`${projectKey}:tasks`}
        label={t('workItems')}
        href={taskHref}
        action={
          can('views', 'create') && (
            <button
              type="button"
              className="helena-tree-toggle"
              aria-label={viewsT('newView')}
              title={viewsT('newView')}
              onClick={onNewView}
            >
              <Plus size={14} />
            </button>
          )
        }
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
        {can('views', 'read') && (
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
          label={t('sidebarKnowledge')}
          href={filesPath(projectKey)}
        >
          {folders?.items
            .filter((item) => item.kind === 'folder')
            .map((folder) => (
              <TreeLink
                key={folder.path}
                href={filesPath(projectKey, folder.path)}
                nested
                activeOverride={activeKnowledgeFolder === folder.path}
              >
                <Folder size={13} className="me-2 inline" />
                {folder.name}
              </TreeLink>
            ))}
        </TreeBranch>
      )}
      {features.dashboards && can('dashboards', 'read') && (
        <TreeBranch
          id={`${projectKey}:dashboard`}
          label={t('dashboards')}
          href={dashboardsPath(projectKey)}
        >
          {dashboards.map((dashboard) => (
            <TreeLink key={dashboard.id} href={dashboardPath(projectKey, dashboard.id)} nested>
              {dashboard.name}
            </TreeLink>
          ))}
        </TreeBranch>
      )}
      <TreeBranch
        id={`${projectKey}:auto`}
        label={t('sidebarAutomation')}
        href={can('ai_agents', 'read') ? aiAgentsPath(projectKey) : agentActivityPath(projectKey)}
        activePaths={[
          organizationPath(projectKey),
          aiTeamPath(projectKey, 'schedules'),
          agentActivityPath(projectKey),
          workflowsPath(projectKey),
          projectApprovalsPath(projectKey),
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
        {can('actions', 'read') && (
          <TreeLink href={workflowsPath(projectKey)} nested>
            {t('workflows')}
          </TreeLink>
        )}
        {can('ai_agents', 'edit') && (
          <TreeLink href={projectApprovalsPath(projectKey)} nested>
            {t('approvals')}
          </TreeLink>
        )}
      </TreeBranch>
      {mailAccounts.length > 0 && <TreeLink href={inboxPath(projectKey)}>{t('inbox')}</TreeLink>}
      {isAdmin && <TreeLink href={receiptsPath(projectKey)}>{t('receipts')}</TreeLink>}
      {features.initiatives && can('initiatives', 'read') && (
        <TreeLink href={initiativesPath(projectKey)}>{t('initiatives')}</TreeLink>
      )}
      {features.cycles && can('cycles', 'read') && (
        <TreeLink href={cyclesPath(projectKey)}>{t('cycles')}</TreeLink>
      )}
      {first && (
        <TreeLink href={first.href} activeOverride={settings.some((item) => item.active)}>
          {t('settings')}
        </TreeLink>
      )}
    </section>
  );
}
