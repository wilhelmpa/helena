import type { LocalizedText } from './text';

// A decision backend (docs/helena-decisions/browser-task.md §3.3): a service that answers typed
// questions over a state in the System One wire format (`POST /v1/systemone`, TypeSafe's Jev
// protocol, also spoken by Laya servers). The browser gateway's fast path (browser_task) asks
// one; the owner picks it per project. Helena ships TypeSafe (Jev Cloud), the Vercel AI Gateway
// and "any Jev-compatible server"; a plugin registers another (a hosted evaluation service, an
// AI SDK evaluation model behind an adapter) the same way.
//
// A backend type only describes: its defaults, where it runs, what it needs, which of the loop's
// policies suits its models. The owner's connection (address, model, key) is a credential of
// kind `decision_model` in Zugänge, which names the type in its `provider` field.

export type DecisionPolicyKind = 'jev' | 'laya';

export interface DecisionBackendPreset {
  id: string;
  label: LocalizedText;
  baseUrl: string;
  model: string;
  // The address is local or private and the owner allows it for this connection.
  allowPrivateAddress?: boolean;
  // The key comes from the local installation's key file (Laya on this server), not from Zugänge.
  keySource?: 'local-laya';
}

export interface DecisionBackendType {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  // 'cloud': page content leaves this machine for the provider; 'local': a machine the owner
  // runs. Shown in the settings, so the choice is made knowingly.
  location: 'cloud' | 'local';
  // Null: the owner enters the address.
  defaultBaseUrl: string | null;
  defaultModel: string;
  presets?: DecisionBackendPreset[];
  // The loop policy its models are served best by (browser-task.md §3.1).
  policy: DecisionPolicyKind;
  keyRequired: boolean;
  // Where the owner gets a key.
  signupUrl?: string;
  // gen_ai.provider.name of the tokens in the usage ledger.
  providerName: string;
}

export const SYSTEM_ONE_PATH = '/v1/systemone';
export const SYSTEM_ONE_MODELS_PATH = '/v1/models';

// The address a connection posts to: the base URL without a trailing slash, plus the path.
export function systemOneUrl(baseUrl: string, path: string = SYSTEM_ONE_PATH): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}${path}`;
}
