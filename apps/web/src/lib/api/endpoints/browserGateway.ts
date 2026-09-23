import { request } from '@/lib/api/core/client';

// A project's browser gateway settings (mirrors apps/api/src/modules/agent-browser-gateway/
// model.ts, design volition-design-browser-gateway.md §8, "Projekt → Einstellungen →
// Browser"): the domain blocklist and optional allowlist the gateway enforces on
// navigation, whether it types and clicks with human-like timing, and how long an agent's
// control lock survives without an action before it is released.
export const MAX_BROWSER_GATEWAY_DOMAINS = 200;
export const MIN_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC = 15;
export const MAX_BROWSER_GATEWAY_LOCK_TIMEOUT_SEC = 3600;

export interface BrowserGatewaySettings {
  // A domain covers its subdomains, same normalization as the agent network's lists. An
  // empty allowlist means "every domain the blocklist does not name"; a non-empty
  // allowlist means only those domains (the blocklist still applies on top).
  domainBlocklist: string[];
  domainAllowlist: string[];
  humanInput: boolean;
  lockTimeoutSec: number;
}

export interface BrowserGatewaySettingsPatch {
  domainBlocklist?: string[];
  domainAllowlist?: string[];
  humanInput?: boolean;
  lockTimeoutSec?: number;
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
// Projekt-Browser"). Every project that could have one, name and key only — the router
// that will serve the live current URL, who controls it, and a thumbnail is still being
// built, so this route carries no live fields yet.
export interface BrowserGatewayOverviewProject {
  projectId: number;
  projectKey: string;
  projectName: string;
}

export const getBrowserGatewayOverview = () =>
  request<{ projects: BrowserGatewayOverviewProject[] }>('/browser-gateway/overview');
