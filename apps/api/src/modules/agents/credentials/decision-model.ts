import { HttpError } from '#shared/lib';
import type { CredentialFields, DecisionKeySource } from './kinds';

// A decision_model credential (docs/helena-decisions/browser-task.md §3.3): which System One
// service, where, which model, whether its local or private address is allowed for this one
// connection, and where its key comes from. Checked here so a connection Helena could not call
// is refused on save.

// The built-in kinds of service (modules/browser-task/backends.ts registers them as decision
// backends); a plugin's own kind is accepted when it is registered.
const BUILTIN = {
  typesafe: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', keyRequired: true },
  vercel: {
    baseUrl: 'https://ai-gateway.vercel.sh/typesafe',
    model: 'typesafe-ai/jev',
    keyRequired: true,
  },
  compatible: { baseUrl: null, model: 'laya-browser-v10s', keyRequired: false },
} as const;

let registered: (
  id: string,
) => { defaultBaseUrl: string | null; defaultModel: string; keyRequired: boolean } | null = () =>
  null;

// The decision backend registry (API's @helena/sdk registries) is handed in at start, so this
// module has no load-order dependency on the plugin host.
export function useDecisionBackendLookup(lookup: typeof registered): void {
  registered = lookup;
}

function kindOf(provider: string) {
  if (provider in BUILTIN) {
    const builtin = BUILTIN[provider as keyof typeof BUILTIN];
    return {
      defaultBaseUrl: builtin.baseUrl,
      defaultModel: builtin.model,
      keyRequired: builtin.keyRequired,
    };
  }
  return registered(provider);
}

export function decisionBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'The address is not a URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'The address must start with https:// or http://.');
  }
  if (url.username || url.password) throw new HttpError(400, 'The address cannot contain a login.');
  if (url.search || url.hash) throw new HttpError(400, 'The address cannot have a query.');
  // "/v1/systemone" is added by Helena; an address that already ends in it is taken as its base.
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1(\/systemone)?$/, '')}`;
}

export function decisionKey(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'The decision service key is invalid.');
  const key = value.trim();
  if (!key) return null;
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new HttpError(400, 'The decision service key must be a single printable ASCII token.');
  }
  return key;
}

type Current = { readable: Record<string, unknown>; secrets: Record<string, string> };

export function composeDecisionModel(fields: CredentialFields, current: Current) {
  const provider = (
    fields.provider ??
    (current.readable.provider as string | undefined) ??
    ''
  ).trim();
  const kind = provider ? kindOf(provider) : null;
  if (!kind) throw new HttpError(400, 'Choose which kind of decision service this is.');
  const baseInput =
    fields.baseUrl ?? (current.readable.baseUrl as string | undefined) ?? kind.defaultBaseUrl;
  if (!baseInput?.trim())
    throw new HttpError(400, 'The address of the decision service is required.');
  const baseUrl = decisionBaseUrl(baseInput);
  const model = (
    fields.model ??
    (current.readable.model as string | undefined) ??
    kind.defaultModel
  )
    .trim()
    .slice(0, 200);
  if (!model) throw new HttpError(400, 'A model name is required.');
  const allowPrivateAddress =
    fields.allowPrivateAddress ??
    (current.readable.allowPrivateAddress as boolean | undefined) ??
    false;
  const keySource: DecisionKeySource =
    fields.keySource ?? (current.readable.keySource as DecisionKeySource | undefined) ?? 'stored';
  const sourceCredentialId =
    keySource === 'credential'
      ? fields.sourceCredentialId === undefined
        ? current.readable.sourceCredentialId
        : fields.sourceCredentialId
      : null;
  if (
    keySource === 'credential' &&
    (!Number.isSafeInteger(sourceCredentialId) || Number(sourceCredentialId) <= 0)
  ) {
    throw new HttpError(400, 'Choose an API key credential for this connection.');
  }
  if (keySource === 'credential' && fields.value !== undefined) {
    throw new HttpError(400, 'A referenced key is changed in its original credential.');
  }
  const value =
    keySource === 'stored'
      ? decisionKey(fields.value === undefined ? current.secrets.value : fields.value)
      : null;
  if (keySource === 'stored' && kind.keyRequired && !value) {
    throw new HttpError(400, 'This service needs a key.');
  }
  // A model server of Helena's local AI brings its own address and key (decisions.md §3.3).
  const modelServer =
    keySource === 'local-ai'
      ? (
          fields.modelServer ??
          (current.readable.modelServer as string | undefined) ??
          'local'
        ).trim()
      : undefined;
  if (modelServer !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(modelServer)) {
    throw new HttpError(400, 'The model server is named by its slug (lower case, digits, -).');
  }
  return {
    readable: {
      provider,
      baseUrl,
      model,
      allowPrivateAddress,
      keySource,
      ...(keySource === 'credential' ? { sourceCredentialId: sourceCredentialId as number } : {}),
      ...(modelServer ? { modelServer } : {}),
    },
    secrets: keySource === 'stored' && value ? { value } : ({} as Record<string, string>),
  };
}
