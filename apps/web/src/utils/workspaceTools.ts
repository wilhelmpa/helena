import type { WorkspaceRuntimeEnv } from './runtimeEnv';
import type { ProvisionedProjectResource } from '@/lib/api/endpoints/projects';

export const WORKSPACE_TOOL_IDS = [
  'chat',
  'terminal',
  'code',
  'browser',
  'files',
  'paperless',
  'inbox',
  'mail',
  'connections',
] as const;

export type WorkspaceToolId = (typeof WORKSPACE_TOOL_IDS)[number];

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

function childUrl(base: string, path: string): string {
  if (!base) return '';
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    return url.toString();
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

export function coordinatorId(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[] = [],
): string {
  if (!projectKey) return config.coordinatorId || 'coordinator';
  const provisioned = provisionedResource(resources, 'coordinator');
  if (provisioned?.id) return provisioned.id;
  const mapped = projectValue(config.projectCoordinators, projectKey);
  if (mapped) return mapped;
  const normalizedKey = projectKey.trim().toUpperCase();
  const slug = normalizedKey === 'VERV' ? 'verve' : normalizedKey.toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(slug) ? `${slug}-coordinator` : '';
}

function codeUrl(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[],
): string {
  const provisioned = provisionedResource(resources, 'workspace');
  const provisionedUrl = trustedResourceUrl(provisioned?.url, [config.codeUrl]);
  if (provisionedUrl) return provisionedUrl;
  if (!config.codeUrl) return '';
  const workspacePath = projectValue(config.projectWorkspacePaths, projectKey);
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

export function workspaceTools(
  config: WorkspaceRuntimeEnv,
  projectKey: string | null,
  resources: ProvisionedProjectResource[] = [],
): Record<WorkspaceToolId, WorkspaceTool> {
  const openClawUrl = frameUrl(config.openClawUrl);
  const coordinator = provisionedResource(resources, 'coordinator');
  const chatUrl =
    trustedResourceUrl(coordinator?.url, [openClawUrl]) ||
    childUrl(
      openClawUrl,
      `chat/${encodeURIComponent(coordinatorId(config, projectKey, resources))}`,
    );
  const terminal = provisionedResource(resources, 'terminal');
  const browser = provisionedResource(resources, 'browser');
  const files = provisionedResource(resources, 'files');
  const tools = {
    chat: { id: 'chat', url: chatUrl, advancedUrl: openClawUrl },
    terminal: {
      id: 'terminal',
      url:
        trustedResourceUrl(terminal?.url, [config.terminalUrl, openClawUrl]) ||
        frameUrl(config.terminalUrl) ||
        childUrl(openClawUrl, 'focus/terminal'),
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
    paperless: { id: 'paperless', url: frameUrl(config.paperlessUrl), advancedUrl: '' },
    mail: { id: 'mail', url: '', advancedUrl: '' },
    inbox: { id: 'inbox', url: frameUrl(config.inboxUrl), advancedUrl: '' },
    connections: { id: 'connections', url: frameUrl(config.connectionsUrl), advancedUrl: '' },
  } satisfies Record<WorkspaceToolId, WorkspaceTool>;
  return tools;
}

export function workspaceFrameOrigins(config: WorkspaceRuntimeEnv): string[] {
  const candidates = [
    config.openClawUrl,
    config.terminalUrl,
    config.codeUrl,
    config.browserUrl,
    config.filesUrl,
    config.paperlessUrl,
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
