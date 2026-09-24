import type { ActionCategory } from './actions';
import type { LocalizedText } from './text';
import type { AnyAgentTool } from './tools';

// A connector is an outside account Helena holds a credential for: a Google account, a
// mail server, a web login, an API key, an MCP/OAuth connection. It says what the
// credential looks like, how a person gets one (a form, an OAuth flow), which services it
// opens, how to tell it still works, and which agent tools run with it. The access center
// stores credentials and grants; the connector only describes and uses them.

export type CredentialFieldType = 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'text';

export interface CredentialField {
  key: string;
  label: LocalizedText;
  type: CredentialFieldType;
  required: boolean;
  placeholder?: string;
  help?: LocalizedText;
}

export type CredentialValues = Record<string, string | number | boolean>;

// How a person connects an account. `fields` fills the credentialSchema in a form;
// `oauth2` is the standard authorization-code flow with PKCE, run by the host (the
// connector only names the endpoints and scopes); `custom` is a flow of the connector's
// own, such as a device code or a CLI's headless login.
export type ConnectorAuth =
  | { kind: 'fields' }
  | {
      kind: 'oauth2';
      authorizationUrl: string;
      tokenUrl: string;
      scopes: string[];
      // Extra parameters of the authorization request (access_type=offline, prompt=consent).
      params?: Record<string, string>;
    }
  | {
      kind: 'custom';
      // Starts the flow: a URL to open, or a code to show together with one.
      start(ctx: ConnectorAuthContext): Promise<ConnectorAuthStep>;
      // Finishes it with what the person brought back, and returns the credential.
      complete(ctx: ConnectorAuthContext, input: Record<string, string>): Promise<CredentialValues>;
    };

export interface ConnectorAuthContext {
  // Where the flow returns to, for a redirect-based flow.
  redirectUrl: string;
  state: string;
}

export type ConnectorAuthStep =
  | { kind: 'redirect'; url: string }
  | { kind: 'code'; url: string; userCode: string; expiresAt?: string }
  | { kind: 'input'; fields: CredentialField[] };

// One service an account opens (Mail, Calendar, Drive …), with the actions using it can
// take, which is what a grant and a policy are expressed in.
export interface ConnectorService {
  id: string;
  label: LocalizedText;
  actions: ActionCategory[];
}

export interface ConnectorHealth {
  status: 'ok' | 'degraded' | 'error';
  message?: string;
  checkedAt?: string;
}

export interface Connector {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  // A lucide icon name, or a path to an SVG shipped with the plugin.
  icon?: string;
  credentialSchema: CredentialField[];
  auth?: ConnectorAuth;
  services?: ConnectorService[];
  health?(credential: CredentialValues): Promise<ConnectorHealth>;
  tools?: AnyAgentTool[];
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

// Validates and coerces a submitted credential against a schema: required fields must be
// present, values are coerced to each field's type, unknown keys are dropped.
export function coerceCredential(fields: CredentialField[], input: unknown): CredentialValues {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: CredentialValues = {};
  for (const field of fields) {
    const raw = src[field.key];
    const name = typeof field.label === 'string' ? field.label : field.key;
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) throw new CredentialError(`Missing required setting: ${name}`);
      continue;
    }
    switch (field.type) {
      case 'number': {
        const n = Number(raw);
        if (Number.isNaN(n)) throw new CredentialError(`Setting ${name} must be a number`);
        out[field.key] = n;
        break;
      }
      case 'boolean':
        out[field.key] = raw === true || raw === 'true';
        break;
      default:
        out[field.key] = String(raw);
    }
  }
  return out;
}

// The credential for a list view: secrets masked to their last four characters.
export function redactCredential(
  fields: CredentialField[],
  values: CredentialValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.key in values)) continue;
    if (field.type === 'secret') {
      const s = String(values[field.key]);
      out[field.key] = s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
    } else {
      out[field.key] = values[field.key];
    }
  }
  return out;
}
