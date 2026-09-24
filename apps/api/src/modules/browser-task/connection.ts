import { lstat, readFile } from 'node:fs/promises';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { SYSTEM_ONE_MODELS_PATH, systemOneUrl, type DecisionBackendType } from '@helena/sdk';
import { pinnedFetch, UrlNotAllowedError } from '@repo/net';
import { db, integrationCredential, openCredential } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
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
  keySource: 'stored' | 'local-laya';
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

// The key file of the local Laya service (install.sh writes it, root:volition-plan 0640).
export function localLayaKeyFile(): string {
  return process.env.HELENA_LAYA_KEY_FILE?.trim() || '/etc/helena/laya.key';
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
    keySource: readable.keySource === 'local-laya' ? 'local-laya' : 'stored',
  };
}

async function keyOf(connection: DecisionConnection): Promise<string | null> {
  if (connection.keySource === 'local-laya') {
    const file = localLayaKeyFile();
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const key = (await readFile(file, 'utf8')).trim();
      return key || null;
    } catch {
      return null;
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
  return secrets.value?.trim() || null;
}

function privateHosts(connection: DecisionConnection): string[] {
  if (!connection.allowPrivateAddress) return [];
  try {
    return [new URL(connection.baseUrl).hostname.replace(/^\[|\]$/g, '')];
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

function clientOf(connection: DecisionConnection, key: string | null): TypeSafeClient {
  return new TypeSafeClient({
    // A server without a key (a local one) ignores the header.
    apiKey: key ?? 'none',
    baseURL: connection.baseUrl,
    defaultModel: connection.model,
    fetch: guardedFetch(privateHosts(connection)),
    timeout: 20_000,
    // One retry on 429/529 (the SDK honours retry-after); the loop has its own budget.
    retry: { maxRetries: 1 },
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
  if (status === 429 || status === 529)
    return {
      status: 503,
      message: 'The decision service is busy (HTTP ' + status + '); try again shortly.',
    };
  if (typeof status === 'number')
    return { status: 502, message: `The decision service answered HTTP ${status}.` };
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message))
    return { status: 504, message: 'The decision service did not answer in time.' };
  return {
    status: 502,
    message: `The decision service could not be reached (${message.slice(0, 120)}).`,
  };
}

export async function askSystemOne(
  connection: DecisionConnection,
  request: { state: unknown; questions: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<SystemOneReply> {
  const key = await keyOf(connection);
  if (!key && connection.backend.keyRequired) {
    throw new HttpError(409, `The connection "${connection.label}" has no key yet (Zugänge).`);
  }
  const started = performance.now();
  const response = await clientOf(connection, key)
    .systemOne(
      {
        state: request.state as never,
        questions: request.questions as never,
        model: connection.model,
      },
      { signal },
    )
    .catch((error: unknown) => {
      const failure = describeFailure(error);
      throw new HttpError(failure.status, failure.message);
    });
  const body = response as unknown as {
    model?: unknown;
    answers?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  if (!body || typeof body.answers !== 'object' || body.answers === null) {
    throw new HttpError(502, 'The decision service answered without answers.');
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
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  models: string[];
  latencyMs: number | null;
}

// "Verbindung testen": the model list where the service has one (TypeSafe, Vercel,
// laya-browser-agent), otherwise a one-question probe.
export async function testConnection(connection: DecisionConnection): Promise<ConnectionTest> {
  const key = await keyOf(connection);
  if (!key && connection.backend.keyRequired) {
    return { ok: false, message: 'no_key', models: [], latencyMs: null };
  }
  if (!key && connection.keySource === 'local-laya') {
    return { ok: false, message: 'no_local_key', models: [], latencyMs: null };
  }
  const started = performance.now();
  try {
    const res = await guardedFetch(privateHosts(connection), 10_000)(
      systemOneUrl(connection.baseUrl, SYSTEM_ONE_MODELS_PATH),
      { headers: key ? { authorization: `Bearer ${key}` } : {} },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        models?: { name?: unknown }[];
        data?: { id?: unknown }[];
      } | null;
      const models = [
        ...(body?.models ?? []).map((m) => m.name),
        ...(body?.data ?? []).map((m) => m.id),
      ].filter((name): name is string => typeof name === 'string');
      return {
        ok: true,
        message: 'ok',
        models: models.slice(0, 50),
        latencyMs: Math.round(performance.now() - started),
      };
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
    return {
      ok: true,
      message: 'ok',
      models: reply.model ? [reply.model] : [],
      latencyMs: reply.latencyMs,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof HttpError ? error.message : describeFailure(error).message,
      models: [],
      latencyMs: null,
    };
  }
}
