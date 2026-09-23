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

export const updateBrowserGatewaySettingsBody = t.Object({
  domainBlocklist: t.Optional(DomainList),
  domainAllowlist: t.Optional(DomainList),
  humanInput: t.Optional(t.Boolean()),
  lockTimeoutSec: t.Optional(
    t.Number({ minimum: MIN_LOCK_TIMEOUT_SEC, maximum: MAX_LOCK_TIMEOUT_SEC }),
  ),
});

// --- internal (gateway <-> Plan) wire shapes -------------------------------------------

export const internalResolveBody = t.Object({
  agentKey: t.String({ minLength: 1, maxLength: 200 }),
  projectKey: t.String({ minLength: 1, maxLength: 32 }),
});

export const InternalResolveResponse = t.Object({
  agentId: t.Number(),
  agentName: t.String(),
  teamId: t.Number(),
  projectId: t.Number(),
  browserGatewayEnabled: t.Boolean(),
  settings: BrowserGatewaySettingsResponse,
});

export const internalLoginBody = t.Object({
  agentKey: t.String({ minLength: 1, maxLength: 200 }),
  projectKey: t.String({ minLength: 1, maxLength: 32 }),
  frameOrigin: t.String({ minLength: 1, maxLength: 500 }),
  credentialId: t.Optional(t.Number()),
  runId: t.Optional(t.Number()),
  messageId: t.Optional(t.Number()),
});

// Never totpSecret — only whether one exists (browser_login_code fetches the code itself,
// on a separate call, once the field it belongs to is focused).
export const InternalLoginResult = t.Object({
  id: t.Number(),
  label: t.String(),
  username: t.String(),
  password: t.String(),
  has2fa: t.Boolean(),
});

export const InternalLoginResponse = t.Union([
  t.Object({ status: t.Literal('filled'), login: InternalLoginResult }),
  t.Object({
    status: t.Literal('choose'),
    // No password, no username-adjacent secret — just enough to ask the agent to call
    // browser_login again with an id (design §6: "Liste mit Label und Benutzername zur
    // Auswahl, ohne Passwort").
    candidates: t.Array(t.Object({ id: t.Number(), label: t.String(), username: t.String() })),
  }),
  t.Object({ status: t.Literal('none') }),
]);

export const internalLoginCodeBody = t.Object({
  agentKey: t.String({ minLength: 1, maxLength: 200 }),
  credentialId: t.Number(),
});

export const InternalLoginCodeResponse = t.Object({
  code: t.String(),
  secondsRemaining: t.Number(),
});

export const internalAuditBody = t.Object({
  agentKey: t.String({ minLength: 1, maxLength: 200 }),
  projectKey: t.String({ minLength: 1, maxLength: 32 }),
  actor: t.Union([t.Literal('agent'), t.Literal('owner')]),
  tool: t.String({ minLength: 1, maxLength: 64 }),
  target: t.Optional(t.String({ maxLength: 300 })),
});
