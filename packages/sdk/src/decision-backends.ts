import type { LocalizedText } from './text';

// A decision backend (docs/helena-decisions/browser-task.md §3.3): a service that answers typed
// questions over a state in the System One wire format (`POST /v1/systemone`, TypeSafe's Jev
// protocol). The browser gateway's fast path (browser_task) asks
// one; the owner picks it per project. Helena ships TypeSafe (Jev Cloud), the Vercel AI Gateway
// and "any Jev-compatible server"; a plugin registers another (a hosted evaluation service, an
// AI SDK evaluation model behind an adapter) the same way.
//
// A backend type only describes: its defaults, where it runs, what it needs, which of the loop's
// policies suits its models. The owner's connection (address, model, key) is a credential of
// kind `decision_model` in Zugänge, which names the type in its `provider` field.

export type DecisionPolicyKind = 'jev';

// How Helena talks to a backend. Every protocol answers the same System One questions
// (`noul`, `choice`), so the browser loop and the decisions service ask any backend alike:
// - `systemone`: POST /v1/systemone (TypeSafe's Jev and compatible servers);
// - `openai-logprobs`: an OpenAI-compatible chat completion of one token whose top log
//   probabilities over the option labels are the answer (a small local LLM on llama.cpp or
//   Lemonade: the "local logit" backend, SemIf-OpenJev's idea without its Python stack);
// - `openai-json`: an OpenAI-compatible chat completion constrained to a JSON answer
//   (any chat model; the stated confidence is not calibrated, the class threshold decides).
export type DecisionProtocol = 'systemone' | 'openai-logprobs' | 'openai-json';

export const DECISION_PROTOCOLS: readonly DecisionProtocol[] = [
  'systemone',
  'openai-logprobs',
  'openai-json',
];

export interface DecisionBackendPreset {
  id: string;
  label: LocalizedText;
  baseUrl: string;
  model: string;
  // The address is local or private and the owner allows it for this connection.
  allowPrivateAddress?: boolean;
  // A model server of Helena's local AI supplies its address and key.
  keySource?: 'local-ai';
  modelServer?: string;
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
  // How Helena asks it; `systemone` when absent.
  protocol?: DecisionProtocol;
  keyRequired: boolean;
  // Where the owner gets a key.
  signupUrl?: string;
  // gen_ai.provider.name of the tokens in the usage ledger.
  providerName: string;
}

export const SYSTEM_ONE_PATH = '/v1/systemone';
export const SYSTEM_ONE_MODELS_PATH = '/v1/models';

// The address a connection posts to: the base URL without a trailing slash, plus the path.
// A base that already ends in the path's version (`…/api/v1`, as OpenAI-compatible servers and
// Helena's local AI write it) does not get it twice.
export function systemOneUrl(baseUrl: string, path: string = SYSTEM_ONE_PATH): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const version = /^\/v\d+\//.exec(path)?.[0].slice(0, -1);
  return version && base.endsWith(version)
    ? `${base}${path.slice(version.length)}`
    : `${base}${path}`;
}
