import { t } from 'elysia';

export { projectKeyParams as browserGatewayProjectParams } from '../issues/model';

// Per-project browser gateway settings (design: volition-design-browser-gateway.md §8,
// "Projekt → Einstellungen → Browser"), stored as project_setting under this key — the same
// generic key-value store agent-network already uses (agent-egress/service.ts).
export const MAX_DOMAINS = 200;
export const MAX_DOMAIN_LENGTH = 253;
export const MIN_LOCK_TIMEOUT_SEC = 15;
export const MAX_LOCK_TIMEOUT_SEC = 3600;
export const DEFAULT_LOCK_TIMEOUT_SEC = 120;

export interface BrowserGatewaySettings {
  // A domain covers its subdomains, same normalization as agent-network's lists. An empty
  // allowlist means "every domain the blocklist does not name"; a non-empty allowlist means
  // only those domains (the blocklist still applies on top, so an owner can allow a domain
  // and still carve out one of its subdomains).
  domainBlocklist: string[];
  domainAllowlist: string[];
  // Off replaces the human-like pointer/typing timing (design §7) with the fastest
  // still-correct input, for a project the owner is happy to run less carefully in (a
  // sandboxed test project, say). On by default.
  humanInput: boolean;
  // Seconds an agent's control lock survives without an action before it is released
  // (design §5: "Nach 120 s ohne Aktion verfällt die Sperre eines Agenten").
  lockTimeoutSec: number;
}

export const DEFAULT_BROWSER_GATEWAY_SETTINGS: BrowserGatewaySettings = {
  domainBlocklist: [],
  domainAllowlist: [],
  humanInput: true,
  lockTimeoutSec: DEFAULT_LOCK_TIMEOUT_SEC,
};

const DomainList = t.Array(t.String({ minLength: 1, maxLength: MAX_DOMAIN_LENGTH + 2 }), {
  maxItems: MAX_DOMAINS,
});

export const BrowserGatewaySettingsResponse = t.Object({
  domainBlocklist: t.Array(t.String()),
  domainAllowlist: t.Array(t.String()),
  humanInput: t.Boolean(),
  lockTimeoutSec: t.Number(),
});

// Home's "Browser" overview (design §5, §8: "Home → Browser: Übersicht"): the projects the
// caller works in, each with the slug of its project browser. The live state of each
// browser comes from the browser router (/browser/api/overview), not from here.
export const BrowserGatewayOverviewResponse = t.Object({
  projects: t.Array(
    t.Object({
      projectId: t.Number(),
      projectKey: t.String(),
      projectName: t.String(),
      slug: t.String(),
    }),
  ),
});

export const updateBrowserGatewaySettingsBody = t.Object({
  domainBlocklist: t.Optional(DomainList),
  domainAllowlist: t.Optional(DomainList),
  humanInput: t.Optional(t.Boolean()),
  lockTimeoutSec: t.Optional(
    t.Number({ minimum: MIN_LOCK_TIMEOUT_SEC, maximum: MAX_LOCK_TIMEOUT_SEC }),
  ),
});
