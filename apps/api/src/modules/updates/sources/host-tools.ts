import {
  compareVersions,
  isNewerVersion,
  type UpdateCandidate,
  type UpdateCheckContext,
  type UpdateSource,
} from '@helena/sdk';
import {
  GITHUB_HOSTS,
  NPM_HOST,
  OSV_HOST,
  githubNewest,
  githubNotes,
  hostInventory,
  npmLatest,
  osvAffected,
  plainVersion,
} from './vendors';
import { sendHelperRequest } from '../helper';
import { helperProgress } from './cli-runtimes';

// The programs Helena's services run on: Bun (API, worker, runner), Node.js (the runner,
// the CLI runtimes), code-server, Wetty (project terminals) and KasmVNC (the project
// browsers' desktop view). Their installed versions come from the root helper's inventory;
// the API's own Bun is known without it. Only an installed helper advertising this
// capability can apply a pinned version; an older helper remains read-only.

export const HOST_TOOLS_SOURCE_ID = 'host-tools';
const NODE_HOST = 'nodejs.org';

interface ToolInfo {
  component: string;
  name: string;
  repository: string;
  newest(context: UpdateCheckContext, installed: string | null): Promise<string | null>;
  // Whether the step from installed to newest fixes a vulnerability.
  security?(context: UpdateCheckContext, installed: string, newest: string): Promise<boolean>;
}

interface NodeRelease {
  version: string;
  lts: string | false;
  security: boolean;
}

async function nodeIndex(context: UpdateCheckContext): Promise<NodeRelease[]> {
  const index = await context.fetchJson<NodeRelease[]>(`https://${NODE_HOST}/dist/index.json`, {
    maxBytes: 2 * 1024 * 1024,
  });
  return Array.isArray(index) ? index.filter((entry) => typeof entry?.version === 'string') : [];
}

function majorOf(version: string): string {
  return version.replace(/^v/, '').split('.')[0]!;
}

// Node: the newest release of the installed major line. A newer LTS line is a migration,
// not an update; it is named in the detail instead.
async function nodeNewest(context: UpdateCheckContext, installed: string | null) {
  const releases = await nodeIndex(context);
  const line = installed ? majorOf(installed) : null;
  const candidates = releases
    .map((entry) => entry.version.replace(/^v/, ''))
    .filter((version) => (line ? majorOf(version) === line : true));
  return candidates.sort((a, b) => compareVersions(b, a) ?? 0)[0] ?? null;
}

async function nodeSecurity(context: UpdateCheckContext, installed: string, newest: string) {
  const releases = await nodeIndex(context);
  return releases.some((entry) => {
    const version = entry.version.replace(/^v/, '');
    return (
      entry.security &&
      (compareVersions(version, installed) ?? 0) > 0 &&
      (compareVersions(version, newest) ?? 1) <= 0
    );
  });
}

// Tools installed as Debian packages; their version carries a Debian revision.
const DPKG_TOOLS = new Set(['kasmvnc']);

const TOOLS: ToolInfo[] = [
  {
    component: 'uv',
    name: 'uv / uvx',
    repository: 'astral-sh/uv',
    newest: (context) => githubNewest(context, 'astral-sh/uv'),
  },
  {
    component: 'bun',
    name: 'Bun',
    repository: 'oven-sh/bun',
    newest: (context) => npmLatest(context, 'bun'),
  },
  {
    component: 'node',
    name: 'Node.js',
    repository: 'nodejs/node',
    newest: nodeNewest,
    security: nodeSecurity,
  },
  {
    component: 'code-server',
    name: 'code-server',
    repository: 'coder/code-server',
    newest: (context) => githubNewest(context, 'coder/code-server'),
  },
  {
    component: 'wetty',
    name: 'Wetty',
    repository: 'butlerx/wetty',
    newest: (context) => npmLatest(context, 'wetty'),
    security: (context, installed) => osvAffected(context, 'wetty', installed),
  },
  {
    component: 'kasmvnc',
    name: 'KasmVNC',
    repository: 'kasmtech/KasmVNC',
    newest: (context) => githubNewest(context, 'kasmtech/KasmVNC'),
  },
];

async function installedVersion(
  context: UpdateCheckContext,
  component: string,
): Promise<string | null> {
  const inventory = await hostInventory(context);
  const value = inventory?.tools?.[component] ?? null;
  // A Debian package's version (KasmVNC) without its epoch and Debian revision.
  const raw = DPKG_TOOLS.has(component)
    ? (value?.replace(/^\d+:/, '').replace(/-[^-]*$/, '') ?? null)
    : value;
  const reported = plainVersion(raw);
  if (reported) return reported;
  // The API runs on the host's Bun; without the helper that is the one Bun known.
  return component === 'bun' ? plainVersion(Bun.version) : null;
}

async function checkOne(
  context: UpdateCheckContext,
  tool: ToolInfo,
): Promise<UpdateCandidate | null> {
  const installed = await installedVersion(context, tool.component);
  // A tool that is not on this host is left out rather than listed as missing.
  if (!installed) return null;
  let available: string | null = null;
  let error: string | null = null;
  try {
    available = await tool.newest(context, installed);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const updateAvailable = isNewerVersion(available, installed);
  const applicable =
    (await hostInventory(context))?.hostToolApply?.includes(tool.component) ?? false;
  let security = false;
  if (updateAvailable && tool.security) {
    security = await tool.security(context, installed, available!).catch(() => false);
  }
  return {
    component: tool.component,
    name: tool.name,
    installed,
    available,
    updateAvailable,
    security,
    sourceUrl: `https://github.com/${tool.repository}`,
    notesUrl: `https://github.com/${tool.repository}/releases`,
    applicable,
    hint: applicable ? null : { i18n: 'updates.hints.manual' },
    error,
  };
}

export const hostToolsSource: UpdateSource = {
  id: HOST_TOOLS_SOURCE_ID,
  label: { i18n: 'updates.sources.hostTools' },
  kind: 'tool',
  order: 40,
  hosts: [NPM_HOST, NODE_HOST, OSV_HOST, ...GITHUB_HOSTS],
  async check(context) {
    const found = await Promise.all(TOOLS.map((tool) => checkOne(context, tool)));
    return found.filter((entry): entry is UpdateCandidate => entry !== null);
  },
  async releaseNotes(candidate, context) {
    const tool = TOOLS.find((entry) => entry.component === candidate.component);
    if (!tool || !candidate.available) return null;
    return githubNotes(context, tool.repository, candidate.installed, candidate.available);
  },
  async apply(request) {
    if (!TOOLS.some((tool) => tool.component === request.component)) {
      throw new Error(`Unknown host tool ${request.component}`);
    }
    const ref = await sendHelperRequest('host-tool', {
      tool: request.component,
      version: request.target,
    });
    return { ref };
  },
  progress: (ref) => helperProgress(ref),
};
