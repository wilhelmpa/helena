import type { WorkspaceRuntimeEnv } from './runtimeEnv';
import type { ProvisionedProjectResource } from '@/lib/api/endpoints/projects';

export const WORKSPACE_TOOL_IDS = [
  'chat',
  'terminal',
  'code',
  'browser',
  'files',
  'inbox',
  'mail',
  'connections',
] as const;

export type WorkspaceToolId = (typeof WORKSPACE_TOOL_IDS)[number];

// The tools the header offers, in its order.
export const HEADER_WORKSPACE_TOOLS = ['chat', 'terminal', 'code', 'browser', 'mail'] as const;

export interface WorkspaceTool {
  id: WorkspaceToolId;
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

function trustedResourceUrl(value: string | undefined, trustedBases: string[]): string {
  const candidate = frameUrl(value ?? '');
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

export function preferredAgentUsername(projectKey: string | null): string {
  if (!projectKey) return 'master';
  const normalizedKey = projectKey.trim().toUpperCase();
  const slug = normalizedKey === 'VERV' ? 'verve' : normalizedKey.toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(slug) ? `hermes-${slug}-coordinator` : '';
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
  if (
    provisionedUrl &&
    new URL(provisionedUrl).pathname.replace(/\/+$/, '') ===
      new URL(config.codeUrl).pathname.replace(/\/+$/, '')
  ) {
    return provisionedUrl;
  }
  if (!config.codeUrl) return '';
  const workspacePath = projectValue(config.projectWorkspacePaths, projectKey) || provisioned?.id;
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
  const slug =
    resourceSlug ??
    (projectSlug && /^[a-z0-9][a-z0-9-]{0,31}$/.test(projectSlug) ? projectSlug : '');
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

export function workspaceTools(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[] = [],
): Record<WorkspaceToolId, WorkspaceTool> {
  const browser = provisionedResource(resources, 'browser');
  const files = provisionedResource(resources, 'files');
  const tools = {
    chat: { id: 'chat', url: '', advancedUrl: '' },
    terminal: {
      id: 'terminal',
      url: terminalUrl(config, projectKey, resources),
      advancedUrl: '',
    },
    code: { id: 'code', url: codeUrl(config, projectKey, resources), advancedUrl: '' },
    browser: {
      id: 'browser',
      url: trustedResourceUrl(browser?.url, [config.browserUrl]) || frameUrl(config.browserUrl),
      advancedUrl: '',
    },
    files: {
      id: 'files',
      url: trustedResourceUrl(files?.url, [config.filesUrl]) || frameUrl(config.filesUrl),
      advancedUrl: '',
    },
    mail: { id: 'mail', url: '', advancedUrl: '' },
    inbox: { id: 'inbox', url: frameUrl(config.inboxUrl), advancedUrl: '' },
    connections: { id: 'connections', url: frameUrl(config.connectionsUrl), advancedUrl: '' },
  } satisfies Record<WorkspaceToolId, WorkspaceTool>;
  return tools;
}

export function workspaceFrameOrigins(config: WorkspaceRuntimeEnv): string[] {
  const candidates = [
    config.terminalUrl,
    config.codeUrl,
    config.browserUrl,
    config.filesUrl,
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
