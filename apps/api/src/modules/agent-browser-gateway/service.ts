import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { db, project, projectSetting } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getProjectSetting, setProjectSetting } from '#shared/project-settings';
import { listProjects } from '#modules/projects/service';
import {
  BROWSER_GATEWAY_MCP_SERVER_NAME,
  agentMcpServerIds,
  listMcpServers,
} from '../agents/mcp-servers/service';
import {
  DEFAULT_BROWSER_GATEWAY_SETTINGS,
  MAX_DOMAINS,
  MAX_DOMAIN_LENGTH,
  type BrowserGatewaySettings,
} from './model';

const SETTING_KEY = 'browser_gateway';

// Same host normalization as agent-network (agent-egress/service.ts): ASCII form, no
// trailing dot, a leading "*." dropped because a domain covers its subdomains anyway.
// Kept independent rather than imported, so this module has no load-order dependency on
// agent-egress; the two lists mean different things (network reachability vs. navigation).
function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host.length > MAX_DOMAIN_LENGTH) return null;
  if (isIP(host)) return host;
  const ascii = domainToASCII(host);
  return ascii && ascii.length <= MAX_DOMAIN_LENGTH ? ascii : null;
}

function normalizeList(values: string[], field: string): string[] {
  const hosts: string[] = [];
  for (const value of values) {
    const host = normalizeHost(value);
    if (!host)
      throw new HttpError(400, `${field} contains an invalid domain: ${value.slice(0, 80)}`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  if (hosts.length > MAX_DOMAINS) throw new HttpError(400, `${field} has too many domains`);
  return hosts.sort();
}

function sanitize(value: unknown): BrowserGatewaySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BROWSER_GATEWAY_SETTINGS };
  const stored = value as Partial<Record<keyof BrowserGatewaySettings, unknown>>;
  const list = (items: unknown) =>
    (Array.isArray(items) ? items : [])
      .flatMap((item) => (typeof item === 'string' ? [normalizeHost(item)] : []))
      .filter((item): item is string => item !== null)
      .slice(0, MAX_DOMAINS);
  return {
    domainBlocklist: list(stored.domainBlocklist),
    domainAllowlist: list(stored.domainAllowlist),
    humanInput: typeof stored.humanInput === 'boolean' ? stored.humanInput : true,
    lockTimeoutSec:
      typeof stored.lockTimeoutSec === 'number' && Number.isFinite(stored.lockTimeoutSec)
        ? stored.lockTimeoutSec
        : DEFAULT_BROWSER_GATEWAY_SETTINGS.lockTimeoutSec,
  };
}

export async function getBrowserGatewaySettings(
  projectId: number,
): Promise<BrowserGatewaySettings> {
  return sanitize(await getProjectSetting(projectId, SETTING_KEY));
}

export interface BrowserGatewaySettingsPatch {
  domainBlocklist?: string[];
  domainAllowlist?: string[];
  humanInput?: boolean;
  lockTimeoutSec?: number;
}

export async function setBrowserGatewaySettings(
  projectId: number,
  patch: BrowserGatewaySettingsPatch,
): Promise<BrowserGatewaySettings> {
  const current = await getBrowserGatewaySettings(projectId);
  const next: BrowserGatewaySettings = {
    domainBlocklist: patch.domainBlocklist
      ? normalizeList(patch.domainBlocklist, 'The blocklist')
      : current.domainBlocklist,
    domainAllowlist: patch.domainAllowlist
      ? normalizeList(patch.domainAllowlist, 'The allowlist')
      : current.domainAllowlist,
    humanInput: patch.humanInput ?? current.humanInput,
    lockTimeoutSec: patch.lockTimeoutSec ?? current.lockTimeoutSec,
  };
  await setProjectSetting(projectId, SETTING_KEY, next);
  return next;
}

// Whether the given host may be navigated to. A non-empty allowlist is exclusive: the host
// (or a parent of it) must be on it; the blocklist always applies on top, so a project can
// allow a domain and still carve one of its subdomains out.
export function hostAllowed(settings: BrowserGatewaySettings, host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  const covers = (list: string[]) =>
    list.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
  if (covers(settings.domainBlocklist)) return false;
  if (settings.domainAllowlist.length > 0 && !covers(settings.domainAllowlist)) return false;
  return true;
}

export interface BrowserGatewayPolicyEntry extends BrowserGatewaySettings {
  projectId: number;
}

// Every project's settings, by key, for the gateway's own policy fetch
// (/internal/browser-gateway/policy) — mirrors agent-egress's egressPolicies().
export async function browserGatewayPolicies(): Promise<Record<string, BrowserGatewayPolicyEntry>> {
  const rows = await db
    .select({ key: project.key, id: project.id, value: projectSetting.value })
    .from(project)
    .leftJoin(
      projectSetting,
      and(eq(projectSetting.projectId, project.id), eq(projectSetting.key, SETTING_KEY)),
    );
  return Object.fromEntries(
    rows.map((row) => [row.key, { projectId: row.id, ...sanitize(row.value) }]),
  );
}

// Whether the agent has "Projekt-Browser" turned on (Agent → Tools). Reuses the same
// library/link tables every other MCP server toggle uses (mcp-servers/service.ts) — the
// gateway is a normal entry there, just one a team cannot edit or delete.
export async function browserGatewayEnabledForAgent(
  agentId: number,
  teamId: number,
): Promise<boolean> {
  const [servers, enabledIds] = await Promise.all([
    listMcpServers(teamId),
    agentMcpServerIds(agentId),
  ]);
  const server = servers.find((row) => row.name === BROWSER_GATEWAY_MCP_SERVER_NAME);
  return server !== undefined && enabledIds.includes(server.id);
}

// Home's "Browser" overview (design §5, §8): every project the caller is a member of, as
// a project could always get a browser gateway. Reuses the projects module's own listing
// rather than a second query, so the set of "eligible" projects is one definition — a
// project template is a separate `project_template` row, never a `project` row, so it is
// never in this list to begin with. No live state (current URL, who controls it, a
// thumbnail): the router that will serve that is still being built (see model.ts,
// BrowserGatewayOverviewResponse).
export async function listBrowserGatewayOverview(
  userId: string,
): Promise<{ projectId: number; projectKey: string; projectName: string }[]> {
  const rows = await listProjects(userId);
  return rows.map((row) => ({ projectId: row.id, projectKey: row.key, projectName: row.name }));
}
