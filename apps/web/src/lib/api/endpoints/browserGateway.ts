import { request } from '@/lib/api/core/client';

// A project's browser gateway settings (mirrors apps/api/src/modules/agent-browser-gateway/
// model.ts, design volition-design-browser-gateway.md §8, "Projekt → Einstellungen →
// Browser"): the domain blocklist and optional allowlist the gateway enforces on
// navigation, whether it types and clicks with human-like timing, and how long an agent's
// control lock survives without an action before it is released.
export const MAX_BROWSER_GATEWAY_DOMAINS = 200;
export const MIN_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC = 15;
export const MAX_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC = 3600;
export const AGENT_VIEWPORT_LIMITS = {
  minWidth: 800,
  maxWidth: 3840,
  minHeight: 600,
  maxHeight: 2400,
};

export interface AgentViewport {
  width: number;
  height: number;
}

export interface BrowserGatewaySettings {
  // A domain covers its subdomains, same normalization as the agent network's lists. An
  // empty allowlist means "every domain the blocklist does not name"; a non-empty
  // allowlist means only those domains (the blocklist still applies on top).
  domainBlocklist: string[];
  domainAllowlist: string[];
  humanInput: boolean;
  lockTimeoutSec: number;
  // The page size while an agent controls the browser; the live view scales it.
  agentViewport: AgentViewport;
  allowLocalAddresses: boolean;
}

export interface BrowserGatewaySettingsPatch {
  domainBlocklist?: string[];
  domainAllowlist?: string[];
  humanInput?: boolean;
  lockTimeoutSec?: number;
  agentViewport?: AgentViewport;
  allowLocalAddresses?: boolean;
}

export const getBrowserGatewaySettings = (projectKey: string) =>
  request<BrowserGatewaySettings>(`/projects/${projectKey}/settings/browser-gateway`);

export const updateBrowserGatewaySettings = (
  projectKey: string,
  patch: BrowserGatewaySettingsPatch,
) =>
  request<BrowserGatewaySettings>(`/projects/${projectKey}/settings/browser-gateway`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

// Home's "Browser" overview (design §5: "eine Seite 'Browser' mit einer Kachel pro
// Projekt-Browser"): the projects the caller works in, each with the slug of its project
// browser. The live state comes from the browser router (utils/browserOverview.ts).
export interface BrowserGatewayOverviewProject {
  projectId: number;
  projectKey: string;
  projectName: string;
  slug: string;
}

export const getBrowserGatewayOverview = () =>
  request<{ projects: BrowserGatewayOverviewProject[] }>('/browser-gateway/overview');
