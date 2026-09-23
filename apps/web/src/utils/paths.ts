// Path builders for the planner routes. The project, the open view and the open
// settings section live in the URL, so these are the single source of truth —
// see the app/project/[projectKey] route tree.
import type { StartPage } from '@/lib/api/endpoints/userPreferences';

export const projectPath = (key: string) => `/project/${encodeURIComponent(key)}`;

export const viewPath = (key: string, viewId: number | null) =>
  viewId != null ? `${projectPath(key)}/view/${viewId}` : projectPath(key);

export const dashboardsPath = (key: string) => `${projectPath(key)}/dashboard`;

export const organizationPath = (key: string) => `${projectPath(key)}/organization`;

export const workflowsPath = (key: string) => `${projectPath(key)}/workflows`;

// The Workflows page with one run's workflow opened and the run marked.
export const workflowRunPath = (key: string, workflowId: string, runId: string) =>
  `${workflowsPath(key)}?${new URLSearchParams({ workflow: workflowId, run: runId })}`;

export const agentActivityPath = (key: string) => `${projectPath(key)}/activity`;

export const connectionsPath = () => '/connections';

export const mailAccountsPath = () => '/mail/accounts';

export const agentsPath = () => '/agents';
export const teamOrganizationPath = () => '/organization';

export const mcpsPath = () => '/mcps';

export const toolsPath = () => '/tools';

export const skillsPath = () => '/skills';

export const credentialsPath = () => '/credentials';

export const devicesPath = () => '/devices';

// The Home pages that read across every project: the task list, the inbox and the
// agent activity, the approvals and the schedules.
export const tasksPath = () => '/tasks';
export const globalInboxPath = () => '/inbox';
export const globalAgentActivityPath = () => '/activity';
export const approvalsPath = () => '/approvals';
export const schedulesPath = () => '/schedules';

// The workflow builder: the team's library of templates in Home and the editor of one
// template, and the editor of a project's own workflow.
export const pipelinesPath = () => '/workflows';
export const pipelinePath = (pipelineId: number) => `${pipelinesPath()}/${pipelineId}`;
export const projectPipelinePath = (key: string, pipelineId: number) =>
  `${workflowsPath(key)}/${pipelineId}`;

// Public read-only share pages (no auth). The token is the unguessable share key.
export const shareIssuePath = (token: string) => `/share/issue/${token}`;
export const shareViewPath = (token: string) => `/share/view/${token}`;

// The absolute share URL to copy, built from the current origin at call time.
export const shareUrl = (path: string) =>
  typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

export const dashboardPath = (key: string, dashboardId: number) =>
  `${dashboardsPath(key)}/${dashboardId}`;

export const notesPath = (key: string) => `${projectPath(key)}/notes`;

export const notePath = (key: string, boardId: number) => `${notesPath(key)}/${boardId}`;

export const documentsPath = (key: string) => `${projectPath(key)}/docs`;

// The Files page and what it opens, all in the address so a link can reopen it: root
// "code" (the workspace instead of the vault folder), a folder, a file in its viewer.
export interface FilesLocation {
  root?: string;
  project?: string;
  file?: string | null;
}

function filesQuery(folder: string | undefined, location: FilesLocation): string {
  const query = new URLSearchParams();
  if (location.root) query.set('root', location.root);
  if (location.project) query.set('project', location.project);
  if (folder) query.set('path', folder);
  if (location.file) query.set('file', location.file);
  const search = query.toString();
  return search ? `?${search}` : '';
}

export const filesPath = (key: string, folder?: string, location: FilesLocation = {}) =>
  `${projectPath(key)}/files${filesQuery(folder, location)}`;

// The Home Files page: Home, Private, Templates and the folder of every project.
export const homeFilesPath = (folder?: string, location: FilesLocation = {}) =>
  `/files${filesQuery(folder, location)}`;

export const codePath = (key: string) => `${projectPath(key)}/code`;

// The Docs of Home: the notes under Home/Docs in the vault.
export const homeDocsPath = () => '/docs';

// The Docs page that opens one note of the vault by its vault-relative path: the Docs of
// its project for a path under Projects/<KEY>/, Home's Docs for any other.
export const vaultNotePath = (path: string) => {
  const [top, key] = path.split('/');
  const base = top === 'Projects' && key ? documentsPath(key) : homeDocsPath();
  return `${base}?path=${encodeURIComponent(path)}`;
};

export const settingsPath = (key: string, section: string) =>
  `${projectPath(key)}/settings/${section}`;

// The AI Team destinations listed in the main sidebar (see AI_TEAM_SECTIONS).
export const aiTeamPath = (key: string, section: string) =>
  `${projectPath(key)}/ai-team/${section}`;

export const inboxPath = (key: string) => `${projectPath(key)}/inbox`;

// The member's own notification preferences (which events, by which channel, their
// Telegram chat id). A main-nav Configuration destination, open to any member.
export const notificationsPath = (key: string) => `${projectPath(key)}/notifications`;

export const aiAgentsPath = (key: string) => `${projectPath(key)}/ai-agents`;

export const mcpServerPath = (key: string) => `${projectPath(key)}/mcp`;

export const apiDocsPath = (key: string) => `${projectPath(key)}/api`;

export const membersPath = (key: string) => `${projectPath(key)}/members`;

// Issues are addressed in the URL by their project-scoped number (the "42" in
// "MKT-42"), not the internal database id: /project/MKT/issue/42.
export const issuePath = (key: string, sequenceNumber: number) =>
  `${projectPath(key)}/issue/${sequenceNumber}`;

// An issue by its identifier, "MKT-42", where a response carries no number of its own.
export const issueIdentifierPath = (identifier: string) => {
  const match = /^(.+)-(\d+)$/.exec(identifier);
  return match ? issuePath(match[1]!, Number(match[2])) : `/${identifier}`;
};

export const initiativesPath = (key: string) => `${projectPath(key)}/initiatives`;

// Every status tab of the initiatives list is a route of its own, "All" included,
// so a reload or a shared link reopens the tab the user was on. The list path
// itself holds no tab: it redirects to the first tab with initiatives in it (see
// InitiativesRedirect). The page and the sorting stay in the query string.
const INITIATIVES_TABS = ['all', 'proposed', 'planned', 'active', 'completed'] as const;

export type InitiativesTab = (typeof INITIATIVES_TABS)[number];

export const isInitiativesTab = (value: string): value is InitiativesTab =>
  (INITIATIVES_TABS as readonly string[]).includes(value);

export const initiativesTabPath = (key: string, tab: InitiativesTab) =>
  `${initiativesPath(key)}/${tab}`;

// The initiative detail tabs are routes of their own too. They sit under /details/
// so the tab segment of the list above stays unambiguous.
export type InitiativeTab = 'overview' | 'progress' | 'issues';

export const initiativePath = (
  key: string,
  initiativeId: number,
  tab: InitiativeTab = 'overview',
) => {
  const base = `${initiativesPath(key)}/details/${initiativeId}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
};

export const cyclesPath = (key: string) => `${projectPath(key)}/cycles`;

// Each layout of the cycles list is a route of its own, so a reload or a shared
// link reopens the one the user was on. The list path itself holds no layout: it
// redirects to the one remembered for the project (see CyclesRedirect).
const CYCLES_VIEWS = ['table', 'timeline'] as const;

export type CyclesView = (typeof CYCLES_VIEWS)[number];

export const isCyclesView = (value: string): value is CyclesView =>
  (CYCLES_VIEWS as readonly string[]).includes(value);

export const cyclesViewPath = (key: string, view: CyclesView) => `${cyclesPath(key)}/${view}`;

// The cycle detail sits under /details/ so the layout segment of the list above
// stays unambiguous.
export const cyclePath = (key: string, cycleId: number) => `${cyclesPath(key)}/details/${cycleId}`;

// Where the app root sends the user, from their start page preference. The section
// opens in the project they were last in (see app/page.tsx).
export const startPagePath = (key: string, startPage: StartPage) => {
  switch (startPage) {
    case 'inbox':
      return inboxPath(key);
    case 'dashboard':
      return dashboardsPath(key);
    case 'initiatives':
      return initiativesPath(key);
    default:
      return projectPath(key);
  }
};

// The standalone Manage teams page, reached from the project switcher. Lists the
// teams the user belongs to and opens one beside the list; with no team in the URL
// it redirects to the first of them.
export const manageTeamsPath = () => '/account/teams';

// Every section of a team is a route of its own, so each loads only what it shows.
// The team itself is the index of the team, so it carries no section segment.
export type TeamSection =
  | 'info'
  | 'projects'
  | 'members'
  | 'roles'
  | 'integrations'
  | 'mcp'
  | 'ai-agents'
  | 'agent-skills'
  | 'agent-tools'
  | 'notifications';

export const teamPath = (teamId: number) => `${manageTeamsPath()}/${teamId}`;

export const teamSectionPath = (teamId: number, section: TeamSection) =>
  section === 'info' ? teamPath(teamId) : `${teamPath(teamId)}/${section}`;

// The invitee-facing link an owner shares. Points at this web app's public
// /invite/:token page, which reads the token and shows the accept screen.
export const inviteLink = (origin: string, token: string) => `${origin}/invite/${token}`;

// God mode: instance administration, outside the project shell (see GOD_SECTIONS).
export const godPath = (section: string) => `/god/${section}`;
