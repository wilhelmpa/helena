import { TypeSafeClient, APITimeoutError } from '@typesafe-ai/sdk';
import {
  isLocalHalogenUrl,
  priorityProxyBaseUrl,
  SYSTEM_ONE_MODELS_PATH,
  systemOneUrl,
  type DecisionBackendType,
} from '@helena/sdk';
import {
  askByJson,
  askByLogprobs,
  readAnswer,
  type OpenAiCompatibleServer,
  type TokenIds,
} from '@helena/decisions';
import { isPrivateIp, pinnedFetch, UrlNotAllowedError } from '@repo/net';
import { db, integrationCredential, openCredential } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { decisionKey } from '#modules/agents/credentials/decision-model';
import {
  DECISION_SOURCE_UNAVAILABLE,
  readDecisionKeySource,
} from '#modules/agents/credentials/decision-key-source';
import type { DecisionKeySource } from '#modules/agents/credentials/kinds';
import { decisionBackend } from './backends';

// A decision model connection from Zugänge (credential kind `decision_model`,
// docs/helena-decisions/browser-task.md §3.3), and the calls Helena makes with it: the System One
// request itself and "Verbindung testen". The key is read here, used for the one call and never
// returned. Every call goes through @repo/net's pinned fetch: https to public addresses only,
// except the one host the owner allowed for this connection.

export interface DecisionConnection {
  credentialId: number;
  teamId: number;
  // The project the credential is limited to, or null for the whole team.
  projectId: number | null;
  label: string;
  backend: DecisionBackendType;
  baseUrl: string;
  model: string;
  allowPrivateAddress: boolean;
  keySource: DecisionKeySource;
  sourceCredentialId: number | null;
  // keySource 'local-ai': the model server of Helena's local AI whose address and key it uses.
  modelServer: string | null;
  localAiClassId?: string;
}

export interface SystemOneReply {
  model: string | null;
  answers: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  // What the backend billed, when it says (Vercel: provider_metadata.gateway.cost).
  providerCostUsd: number | null;
}

export async function loadConnection(credentialId: number): Promise<DecisionConnection | null> {
  const [row] = await db
    .select({
      id: integrationCredential.id,
      teamId: integrationCredential.teamId,
      projectId: integrationCredential.projectId,
      label: integrationCredential.label,
      redacted: integrationCredential.redacted,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.id, credentialId),
        eq(integrationCredential.integrationKey, 'decision_model'),
      ),
    );
  if (!row) return null;
  const readable = (row.redacted ?? {}) as Record<string, unknown>;
  const backend = decisionBackend(readable.provider as string | undefined);
  if (!backend || typeof readable.baseUrl !== 'string') return null;
  if (
    readable.keySource !== undefined &&
    !['stored', 'credential', 'local-ai'].includes(String(readable.keySource))
  )
    return null;
  return {
    credentialId: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    label: row.label ?? '',
    backend,
    baseUrl: readable.baseUrl,
    model:
      typeof readable.model === 'string' && readable.model ? readable.model : backend.defaultModel,
    allowPrivateAddress: readable.allowPrivateAddress === true,
    keySource:
      readable.keySource === 'local-ai' || readable.keySource === 'credential'
        ? readable.keySource
        : 'stored',
    sourceCredentialId:
      readable.keySource === 'credential' && Number.isSafeInteger(readable.sourceCredentialId)
        ? (readable.sourceCredentialId as number)
        : null,
    modelServer:
      readable.keySource === 'local-ai'
        ? typeof readable.modelServer === 'string'
          ? readable.modelServer
          : 'local'
        : null,
  };
}

// Where a connection with keySource 'local-ai' finds its server: Helena's local AI registers
// the resolver (its model servers, their address and key; hub/local-ai), so this module does
// not depend on it. Without one such a connection is not usable.
export interface ModelServerAccess {
  baseUrl: string;
  key: string | null;
  // The model the local AI routes this work to; the connection's own model otherwise.
  model?: string | null;
  // For a server that takes `logit_bias` by token id only (Halogen): the model's token ids.
  tokenIds?: TokenIds;
}

let modelServerResolver:
  ((slug: string, classId: string) => Promise<ModelServerAccess | null>) | null = null;

export function useModelServerResolver(
  resolver: ((slug: string, classId: string) => Promise<ModelServerAccess | null>) | null,
): void {
  modelServerResolver = resolver;
}

// The address a call goes to: the connection's own, or its local AI model server's.
async function addressOf(
  connection: DecisionConnection,
): Promise<{ baseUrl: string; key: string | null; model?: string | null; tokenIds?: TokenIds }> {
  if (connection.keySource === 'local-ai') {
    const server = modelServerResolver
      ? await modelServerResolver(
          connection.modelServer ?? 'local',
          connection.localAiClassId ?? 'decisions',
        )
      : null;
    if (!server) {
      throw new LocalDecisionConnectionError('no-server');
    }
    return {
      baseUrl: server.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, ''),
      key: server.key,
      model: server.model ?? null,
      ...(server.tokenIds && { tokenIds: server.tokenIds }),
    };
  }
  return { baseUrl: connection.baseUrl, key: await keyOf(connection) };
}

// Only locally constructed messages may be returned or persisted unchanged.
export class DecisionConnectionError extends HttpError {}

const LOCAL_FAILURES = {
  'master-off': 'Local AI is switched off',
  'class-off': 'Local AI does not take this class of work',
  'unit-off': "The local AI's GPU is switched off",
  'no-server': 'No local AI model server is set up',
  'server-down': 'The local AI model server does not answer',
  'no-model': 'The local AI server has no model for decisions',
  'eval-failed': "The local model's newest eval for decisions failed",
  'route-changed':
    'Local AI routes decisions to a different model server (Administrator → Lokale KI).',
} as const;

// A closed set of local policy errors, never an arbitrary provider message or cause.
export class LocalDecisionConnectionError extends DecisionConnectionError {
  constructor(reason: keyof typeof LOCAL_FAILURES) {
    super(409, LOCAL_FAILURES[reason] ?? 'The local AI connection is unavailable.');
  }
}

async function safeAddress(connection: DecisionConnection) {
  let address: Awaited<ReturnType<typeof addressOf>>;
  try {
    address = await addressOf(connection);
  } catch (error) {
    if (error instanceof DecisionConnectionError) throw error;
    throw new DecisionConnectionError(
      409,
      'The decision connection could not be loaded (Zugänge).',
    );
  }
  try {
    return { ...address, key: decisionKey(address.key) };
  } catch {
    throw new DecisionConnectionError(409, 'The decision service key is invalid (Zugänge).');
  }
}

// Whether a connection's questions leave this machine: a cloud backend, or an address that is
// not loopback or private. A class whose input may not go to the cloud refuses such a one.
export function connectionIsLocal(connection: DecisionConnection): boolean {
  if (connection.backend.location === 'cloud') return false;
  if (connection.keySource === 'local-ai') return true;
  let host: string;
  try {
    host = new URL(connection.baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan')) return true;
  return isPrivateIp(host);
}

async function keyOf(connection: DecisionConnection): Promise<string | null> {
  if (connection.keySource === 'credential') {
    try {
      const current = await loadConnection(connection.credentialId);
      if (
        !current ||
        current.teamId !== connection.teamId ||
        current.projectId !== connection.projectId ||
        current.keySource !== 'credential' ||
        current.sourceCredentialId !== connection.sourceCredentialId ||
        current.baseUrl !== connection.baseUrl ||
        current.backend.id !== connection.backend.id ||
        current.allowPrivateAddress !== connection.allowPrivateAddress
      ) {
        throw new Error();
      }
      return await readDecisionKeySource(
        current.sourceCredentialId,
        current.teamId,
        current.projectId,
      );
    } catch {
      throw new DecisionConnectionError(409, DECISION_SOURCE_UNAVAILABLE);
    }
  }
  const [row] = await db
    .select({
      id: integrationCredential.id,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, connection.credentialId));
  if (!row?.ciphertext) return null;
  const secrets = JSON.parse(openCredential(row)) as { value?: string };
  return secrets.value ?? null;
}

// The one host a connection may reach although it is local or private: the owner's allowance
// for its own address, or the local AI's own server.
function privateHosts(connection: DecisionConnection, baseUrl = connection.baseUrl): string[] {
  if (!connection.allowPrivateAddress && connection.keySource !== 'local-ai') return [];
  try {
    return [new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')];
  } catch {
    return [];
  }
}

// The SDK's fetch, through the pinned, SSRF-guarded client.
export function guardedFetch(allowPrivateHosts: string[], timeoutMs = 20_000): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.headers;
    const headers =
      raw instanceof Headers
        ? Object.fromEntries(raw)
        : Array.isArray(raw)
          ? Object.fromEntries(raw)
          : ((raw as Record<string, string> | undefined) ?? {});
    return pinnedFetch(url, {
      method: init?.method,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
      timeoutMs,
      maxBytes: 4_000_000,
      allowPrivateHosts,
    });
  }) as typeof fetch;
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function clientOf(
  connection: DecisionConnection,
  key: string | null,
  baseUrl = connection.baseUrl,
  maxRetries: 0 | 1 = 1,
): TypeSafeClient {
  return new TypeSafeClient({
    // A server without a key (a local one) ignores the header.
    apiKey: key ?? 'none',
    baseURL: baseUrl,
    defaultModel: connection.model,
    fetch: guardedFetch(privateHosts(connection, baseUrl)),
    timeout: 20_000,
    // One retry on 429/529 (the SDK honours retry-after); the loop has its own budget.
    retry: { maxRetries },
    logger: quiet,
    logLevel: 'error',
  });
}

function costOf(body: unknown): number | null {
  const cost = (body as { provider_metadata?: { gateway?: { cost?: unknown } } })?.provider_metadata
    ?.gateway?.cost;
  const value = typeof cost === 'string' ? Number(cost) : typeof cost === 'number' ? cost : NaN;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// What went wrong, in words the owner and the agent can act on. Never the key.
export function describeFailure(error: unknown): { status: number; message: string } {
  if (
    error instanceof UrlNotAllowedError ||
    (error as { cause?: unknown })?.cause instanceof UrlNotAllowedError
  ) {
    return {
      status: 400,
      message:
        'The address is local or private and not allowed for this connection ("Lokale Adresse erlauben" in Zugänge), or not https.',
    };
  }
  const status = (error as { status?: unknown })?.status;
  if (status === 401 || status === 403)
    return { status: 502, message: 'The decision service refused the key (HTTP ' + status + ').' };
  if (status === 402)
    return {
      status: 502,
      message: 'The decision service requires billing or credits for this API key (HTTP 402).',
    };
  if (status === 429 || status === 529)
    return {
      status: 503,
      message: 'The decision service is busy (HTTP ' + status + '); try again shortly.',
    };
  if (status === 413)
    return {
      status: 502,
      message: 'The decision request is too large (HTTP 413); reduce its input.',
    };
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599)
    return { status: 502, message: `The decision service answered HTTP ${status}.` };
  if (error instanceof APITimeoutError || (error instanceof Error && error.name === 'TimeoutError'))
    return { status: 504, message: 'The decision service did not answer in time.' };
  return {
    status: 502,
    message: 'The decision service could not be reached or returned an invalid response.',
  };
}

// An OpenAI-compatible server as the local logit and JSON backends talk to it: JSON posts to
// `<base><path>` through the pinned fetch, with the key as a Bearer token.
function openAiServer(
  connection: DecisionConnection,
  address: { baseUrl: string; key: string | null; model?: string | null; tokenIds?: TokenIds },
): OpenAiCompatibleServer {
  const fetcher = guardedFetch(privateHosts(connection, address.baseUrl));
  return {
    model: address.model || connection.model,
    ...(address.tokenIds && { tokenIds: address.tokenIds }),
    async post(path, body, signal) {
      const res = await fetcher(priorityProxyBaseUrl(systemOneUrl(address.baseUrl, path)), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isLocalHalogenUrl(address.baseUrl)
            ? { 'x-volition-halogen-priority': 'background' }
            : {}),
          ...(address.key ? { authorization: `Bearer ${address.key}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return res.json();
    },
  };
}

// One System One request to a connection, whatever protocol its backend speaks: the System One
// endpoint itself, or an OpenAI-compatible server read by logit or asked for JSON
// (@helena/decisions). Every answer comes back in System One shape.
export async function askSystemOne(
  connection: DecisionConnection,
  request: { state: unknown; questions: Record<string, unknown> },
  signal?: AbortSignal,
  options: { maxRetries?: 0 | 1 } = {},
): Promise<SystemOneReply> {
  try {
    const address = await safeAddress(connection);
    if (!address.key && connection.backend.keyRequired) {
      throw new DecisionConnectionError(409, 'The decision connection has no key yet (Zugänge).');
    }
    const started = performance.now();
    const protocol = connection.backend.protocol ?? 'systemone';
    if (protocol !== 'systemone') {
      const server = openAiServer(connection, address);
      const ask = protocol === 'openai-logprobs' ? askByLogprobs : askByJson;
      const result = await ask(server, request as Parameters<typeof askByLogprobs>[1], signal);
      return {
        model: result.model,
        answers: result.answers as unknown as Record<string, unknown>,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Math.round(performance.now() - started),
        providerCostUsd: null,
      };
    }
    const response = await clientOf(
      connection,
      address.key,
      address.baseUrl,
      options.maxRetries,
    ).systemOne(
      {
        state: request.state as never,
        questions: request.questions as never,
        model: connection.model,
      },
      { signal },
    );
    const body = response as unknown as {
      model?: unknown;
      answers?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    if (!body || typeof body.answers !== 'object' || body.answers === null) {
      throw new DecisionConnectionError(502, 'The decision service answered without answers.');
    }
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    return {
      model: typeof body.model === 'string' ? body.model.slice(0, 200) : null,
      answers: body.answers as Record<string, unknown>,
      inputTokens: count(body.usage?.input_tokens),
      outputTokens: count(body.usage?.output_tokens),
      latencyMs: Math.round(performance.now() - started),
      providerCostUsd: costOf(response),
    };
  } catch (error) {
    if (error instanceof DecisionConnectionError) throw error;
    const failure = describeFailure(error);
    throw new DecisionConnectionError(failure.status, failure.message);
  }
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  models: string[];
  latencyMs: number | null;
}

// A model list can be public or available without inference credits. A successful
// connection test also needs one valid, synthetic decision from the configured model.
export async function testConnection(connection: DecisionConnection): Promise<ConnectionTest> {
  let address: { baseUrl: string; key: string | null };
  try {
    address = await safeAddress(connection);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DecisionConnectionError ? error.message : 'no_model_server',
      models: [],
      latencyMs: null,
    };
  }
  const key = address.key;
  if (!key && connection.backend.keyRequired) {
    return { ok: false, message: 'no_key', models: [], latencyMs: null };
  }
  const started = performance.now();
  let models: string[] = [];
  try {
    const res = await guardedFetch(privateHosts(connection, address.baseUrl), 10_000)(
      systemOneUrl(address.baseUrl, SYSTEM_ONE_MODELS_PATH),
      { headers: key ? { authorization: `Bearer ${key}` } : {} },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        models?: { name?: unknown }[];
        data?: { id?: unknown }[];
      } | null;
      models = [...(body?.models ?? []).map((m) => m.name), ...(body?.data ?? []).map((m) => m.id)]
        .filter((name): name is string => typeof name === 'string')
        .slice(0, 50);
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: 'key_refused',
        models: [],
        latencyMs: Math.round(performance.now() - started),
      };
    }
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status === 400)
      return { ok: false, message: 'address_not_allowed', models: [], latencyMs: null };
    // No model list: fall through to the probe.
  }
  try {
    const reply = await askSystemOne(connection, {
      state: 'Helena connection test.',
      questions: { ok: { type: 'noul', instructions: 'Is this a connection test?' } },
    });
    readAnswer({ kind: 'yesno', question: 'Is this a connection test?' }, reply.answers.ok);
    if (models.length === 0 && reply.model) models = [reply.model];
    return {
      ok: true,
      message: 'ok',
      models,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DecisionConnectionError ? error.message : describeFailure(error).message,
      models: [],
      latencyMs: null,
    };
  }
}
