import { hermesProjectCoordinatorUsername } from '@repo/agent-naming';
import { onThisOrigin, type WorkspaceRuntimeEnv } from './runtimeEnv';
import type { ProvisionedProjectResource } from '@/lib/api/endpoints/projects';

// The built-in panel tools, whose frame addresses come from the deployment. Which tools
// the panel has, their order, icons and labels is the panel tool registry
// (extensions/panelTools.tsx), where plugins add theirs.
export const WORKSPACE_TOOL_IDS = [
  'chat',
  'terminal',
  'code',
  'notes',
  'browser',
  'inbox',
  'mail',
  'connections',
] as const;

export type BuiltinWorkspaceToolId = (typeof WORKSPACE_TOOL_IDS)[number];

// A panel tool: a built-in's id, or a plugin's `plugin:<pluginId>:<id>`.
export type WorkspaceToolId = string;

export interface WorkspaceTool {
  id: BuiltinWorkspaceToolId;
  url: string;
  advancedUrl: string;
}

function frameUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

// A provisioned resource's address may name another origin of this instance (the public
// name when the page runs on the home network's, utils/appOrigins.ts): it moves to this one
// before it is compared with the configured tool addresses, which already are on it.
function trustedResourceUrl(value: string | undefined, trustedBases: string[]): string {
  const candidate = frameUrl(onThisOrigin(value ?? ''));
  if (!candidate) return '';
  const candidateOrigin = new URL(candidate).origin;
  return trustedBases.some((base) => {
    const trusted = frameUrl(base);
    return trusted !== '' && new URL(trusted).origin === candidateOrigin;
  })
    ? candidate
    : '';
}

function projectValue(values: Record<string, string>, projectKey: string | null): string {
  if (!projectKey) return '';
  const normalizedKey = projectKey.trim().toUpperCase();
  return values[normalizedKey] ?? values[projectKey] ?? '';
}

function provisionedResource(
  resources: ProvisionedProjectResource[],
  kind: string,
): ProvisionedProjectResource | undefined {
  return resources.find((resource) => resource.kind === kind);
}

// The naming convention itself lives in @repo/agent-naming, shared with the API (which
// creates the coordinator agent with this exact handle) so the two cannot drift apart.
// This wrapper adds only what is specific to picking a chat default: null falls back
// to the Home agent, and a project key that would produce a handle Helena's own
// username rules reject falls back to "no default" rather than a broken preselection.
export function preferredAgentUsername(projectKey: string | null): string {
  if (!projectKey) return 'master';
  const normalizedKey = projectKey.trim().toUpperCase();
  const slugPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  const slug = normalizedKey === 'VERV' ? 'verve' : normalizedKey.toLowerCase();
  return slugPattern.test(slug) ? hermesProjectCoordinatorUsername(normalizedKey) : '';
}

export function nativeChatProjectKey(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
): string | null {
  const key = projectKey ?? config.homeChatProjectKey;
  const normalized = key.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_-]{0,31}$/.test(normalized) ? normalized : null;
}

function codeUrl(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[],
): string {
  const provisioned = provisionedResource(resources, 'workspace');
  const provisionedUrl = trustedResourceUrl(provisioned?.url, [config.codeUrl]);
  const workspacePath =
    projectValue(config.projectWorkspacePaths, projectKey) ||
    provisioned?.id ||
    (projectKey ? '' : config.homeWorkspacePath);
  if (
    provisionedUrl &&
    new URL(provisionedUrl).pathname.replace(/\/+$/, '') ===
      new URL(config.codeUrl).pathname.replace(/\/+$/, '')
  ) {
    // The provisioner may report code-server's bare address: without a folder it
    // reopens whatever folder was open last — another project's (2026-09-24, VOL
    // showed PRIV). The project's own workspace is the resource's id.
    const url = new URL(provisionedUrl);
    if (!url.searchParams.has('folder') && workspacePath?.startsWith('/')) {
      url.searchParams.set('folder', workspacePath);
    }
    return url.toString();
  }
  if (!config.codeUrl) return '';
  if (!workspacePath) return frameUrl(config.codeUrl);
  try {
    const url = new URL(config.codeUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.searchParams.set('folder', workspacePath);
    return url.toString();
  } catch {
    return '';
  }
}

// code-server opened on one folder of the server: a project workspace or a vault folder.
export function codeFolderUrl(config: WorkspaceRuntimeEnv, folder: string): string {
  const base = frameUrl(config.codeUrl);
  if (!base || !folder.startsWith('/')) return '';
  const url = new URL(base);
  url.searchParams.set('folder', folder);
  return url.toString();
}

function terminalUrl(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[],
): string {
  const terminal = provisionedResource(resources, 'terminal');
  const base = frameUrl(config.terminalUrl);
  const resourceSlug = terminal?.id.match(/^terminal-project:([a-z0-9][a-z0-9-]{0,31})$/)?.[1];
  const projectSlug =
    projectKey?.trim().toUpperCase() === 'VERV' ? 'verve' : projectKey?.trim().toLowerCase();
  // Without a project the terminal opens Home's, where the Home agent works.
  const slug =
    resourceSlug ??
    (!projectKey
      ? 'home'
      : projectSlug && /^[a-z0-9][a-z0-9-]{0,31}$/.test(projectSlug)
        ? projectSlug
        : '');
  if (base && slug) {
    const url = new URL(base);
    if (['/terminal', '/focus/terminal-project'].includes(url.pathname.replace(/\/+$/, ''))) {
      url.pathname = `/focus/terminal-project/${slug}`;
      url.search = '';
      return url.toString();
    }
  }
  return trustedResourceUrl(terminal?.url, [config.terminalUrl]) || base;
}

// A provisioner's saved browser URL may still name the old HTTP origin after HTTPS
// migration. The configured browser URL is on the current origin and names Home's
// persistent browser; replace only its project slug, including the VNC socket path.
function browserUrl(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[],
): string {
  const configured = frameUrl(config.browserUrl);
  if (!configured) return '';
  const slug =
    projectKey === null
      ? 'home'
      : projectKey.trim().toUpperCase() === 'VERV'
        ? 'verve'
        : projectKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) return '';
  const url = new URL(configured);
  if (/^\/browser\/projects\/[a-z0-9][a-z0-9-]*\/vnc\.html$/.test(url.pathname)) {
    url.pathname = `/browser/projects/${slug}/vnc.html`;
    url.searchParams.set('path', `browser/projects/${slug}/websockify`);
    return url.toString();
  }
  const browser = provisionedResource(resources, 'browser');
  if (browser?.id.startsWith('project-browser:') && browser.id !== `project-browser:${slug}`)
    return '';
  const provisionedUrl = trustedResourceUrl(browser?.url, [configured]);
  // A generic configured URL cannot select a project on its own.
  return provisionedUrl || (projectKey === null ? configured : '');
}

export function workspaceTools(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[] = [],
): Record<BuiltinWorkspaceToolId, WorkspaceTool> {
  const tools = {
    chat: { id: 'chat', url: '', advancedUrl: '' },
    terminal: {
      id: 'terminal',
      url: terminalUrl(config, projectKey, resources),
      advancedUrl: '',
    },
    code: { id: 'code', url: codeUrl(config, projectKey, resources), advancedUrl: '' },
    // Old saved panels remain inert; files and notes use Helena's canonical Files view.
    notes: { id: 'notes', url: '', advancedUrl: '' },
    browser: {
      id: 'browser',
      url: browserUrl(config, projectKey, resources),
      advancedUrl: '',
    },
    mail: { id: 'mail', url: '', advancedUrl: '' },
    inbox: { id: 'inbox', url: frameUrl(config.inboxUrl), advancedUrl: '' },
    connections: { id: 'connections', url: frameUrl(config.connectionsUrl), advancedUrl: '' },
  } satisfies Record<BuiltinWorkspaceToolId, WorkspaceTool>;
  return tools;
}

export function workspaceFrameOrigins(config: WorkspaceRuntimeEnv): string[] {
  const candidates = [
    config.terminalUrl,
    config.codeUrl,
    config.browserUrl,
    config.inboxUrl,
    config.connectionsUrl,
  ];
  const origins = new Set<string>();
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch {
      continue;
    }
  }
  return [...origins];
}
