import { modelServerBySlug, readLocalAiPolicy, readModelServerKey } from '@repo/db';
import { localCatalogModels } from '#modules/local-ai/service';
import { lemonadeLoaded, LEMONADE_DEFAULT_BASE_URL } from '#modules/local-ai/server-types';
import { HttpError } from '#shared/lib';
import { authorizeLocalTerminal } from './service';
import { signTerminalPayload, verifyTerminalPayload, type OwnerTerminalAccess } from './token';

export const LOCAL_TERMINAL_MODELS = {
  'local-qwen36': 'Qwen3.6-35B-A3B-MTP-GGUF',
  'local-qwen38': 'Qwen3.8-27B-GGUF',
} as const;
export type LocalTerminalKind = keyof typeof LOCAL_TERMINAL_MODELS;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 16 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const ALLOWED_BASES = new Set([LEMONADE_DEFAULT_BASE_URL, 'http://127.0.0.1:13305/v1']);

function capability(token: string, kind: LocalTerminalKind, purpose: string) {
  const value = verifyTerminalPayload(token);
  const access = value?.access as OwnerTerminalAccess | undefined;
  if (
    !value ||
    value.purpose !== purpose ||
    value.kind !== kind ||
    typeof value.sessionId !== 'string' ||
    !access ||
    !Number.isInteger(access.expiresAt) ||
    access.expiresAt > Date.now() / 1000 + 12 * 3600 ||
    !(access.grantId === null
      ? access.grantCreatedAt === null && access.grantExpiresAt === null
      : Number.isSafeInteger(access.grantId) &&
        typeof access.grantCreatedAt === 'string' &&
        typeof access.grantExpiresAt === 'string') ||
    !(access.lanIp === null || typeof access.lanIp === 'string')
  ) {
    throw new HttpError(403, 'local_terminal_capability_invalid');
  }
  return { ...value, sessionId: value.sessionId, access };
}

export async function bootstrapLocalTerminal(request: Request, kind: LocalTerminalKind) {
  const value = capability(
    request.headers.get('x-owner-terminal-token') ?? '',
    kind,
    'owner-terminal',
  );
  await authorizeLocalTerminal(value.sessionId, value.access);
  const { name } = await boundedBody(request);
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name))
    throw new HttpError(400, 'local_terminal_name_invalid');
  await localServer(kind);
  return {
    token: signTerminalPayload({
      purpose: 'owner-local-inference',
      kind,
      name,
      sessionId: value.sessionId,
      access: value.access,
      exp: value.access.expiresAt,
    }),
    expiresAt: value.access.expiresAt,
    model: LOCAL_TERMINAL_MODELS[kind],
  };
}

async function localServer(kind: LocalTerminalKind) {
  const [server, policy] = await Promise.all([modelServerBySlug('local'), readLocalAiPolicy()]);
  const model = LOCAL_TERMINAL_MODELS[kind];
  if (
    !server ||
    server.kind !== 'lemonade' ||
    !ALLOWED_BASES.has(server.baseUrl) ||
    !localCatalogModels(policy, [server]).some((entry) => entry.id === `helena-local/${model}`)
  ) {
    throw new HttpError(503, 'local_terminal_model_unavailable');
  }
  return server;
}

async function loadedModels(server: Awaited<ReturnType<typeof localServer>>, signal?: AbortSignal) {
  const key = await readModelServerKey(server);
  if (server.keySource !== 'none' && !key)
    throw new HttpError(503, 'local_terminal_model_unavailable');
  const health = await fetch(`${server.baseUrl}/health`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
  });
  if (!health.ok) throw new HttpError(503, 'local_terminal_model_unavailable');
  return lemonadeLoaded(await health.json());
}

export async function localTerminalOptions() {
  const kinds = Object.keys(LOCAL_TERMINAL_MODELS) as LocalTerminalKind[];
  const servers = await Promise.all(kinds.map((kind) => localServer(kind).catch(() => null)));
  const server = servers.find((entry) => entry !== null);
  const loaded = server ? await loadedModels(server).catch(() => []) : [];
  return kinds.map((kind, index) => ({
    kind,
    ready:
      servers[index] !== null && loaded.some((entry) => entry.id === LOCAL_TERMINAL_MODELS[kind]),
  }));
}

async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'local_terminal_body_invalid');
  let timedOut = false;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    cancel();
  }, 5000);
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) cancel();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new HttpError(408, 'local_terminal_upload_timeout');
      if (request.signal.aborted) throw new HttpError(400, 'local_terminal_upload_aborted');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) throw new HttpError(413, 'local_terminal_body_too_large');
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'local_terminal_body_invalid');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancel);
  }
}

export function validateLocalRequest(body: Record<string, unknown>, kind: LocalTerminalKind) {
  if (
    body.model !== LOCAL_TERMINAL_MODELS[kind] ||
    body.background === true ||
    body.previous_response_id != null
  ) {
    throw new HttpError(400, 'local_terminal_request_invalid');
  }
  if (
    body.tools !== undefined &&
    (!Array.isArray(body.tools) ||
      body.tools.some(
        (tool) => !tool || typeof tool !== 'object' || !['function', 'custom'].includes(tool.type),
      ))
  ) {
    throw new HttpError(400, 'local_terminal_tools_invalid');
  }
  // Remote media and hosted tools could make the model server fetch outside this
  // owner process. Text URLs remain ordinary input; local image bytes may be data URLs.
  function inspect(value: unknown, depth = 0): void {
    if (depth > 64) throw new HttpError(400, 'local_terminal_input_invalid');
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (
        key === 'file_url' ||
        (key === 'image_url' &&
          (typeof item !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(item)))
      ) {
        throw new HttpError(400, 'local_terminal_media_invalid');
      }
      inspect(item, depth + 1);
    }
  }
  inspect(body.input);
  return { ...body, model: LOCAL_TERMINAL_MODELS[kind], store: false };
}

export async function localTerminalResponse(request: Request, kind: LocalTerminalKind) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const value = capability(token, kind, 'owner-local-inference');
  await authorizeLocalTerminal(value.sessionId, value.access);
  const body = validateLocalRequest(await boundedBody(request), kind);
  const server = await localServer(kind);
  const key = await readModelServerKey(server);
  if (server.keySource !== 'none' && !key)
    throw new HttpError(503, 'local_terminal_model_unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let checking = false;
  const policyTimer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await authorizeLocalTerminal(value.sessionId, value.access);
      await localServer(kind);
    } catch {
      controller.abort();
    } finally {
      checking = false;
    }
  }, 2000);
  let abortStream: (() => void) | null = null;
  const cleanup = () => {
    clearTimeout(timer);
    clearInterval(policyTimer);
    if (abortStream) signal.removeEventListener('abort', abortStream);
  };
  const headers = {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  };
  try {
    // Readiness is a preflight. Root serializes runtime loads/unloads because
    // Lemonade Responses can auto-load if residency changes after this check.
    if (
      !(await loadedModels(server, signal)).some(
        (entry) => entry.id === LOCAL_TERMINAL_MODELS[kind],
      )
    ) {
      throw new HttpError(503, 'local_terminal_model_not_loaded');
    }
    await authorizeLocalTerminal(value.sessionId, value.access);
    await localServer(kind);
    const upstream = await fetch(`${server.baseUrl}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      throw new HttpError(502, 'local_terminal_model_failed');
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!/^(application\/json|text\/event-stream)(;|$)/i.test(contentType)) {
      await upstream.body.cancel();
      throw new HttpError(502, 'local_terminal_model_failed');
    }
    const reader = upstream.body.getReader();
    let size = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(output) {
        abortStream = () => {
          cleanup();
          void reader.cancel().catch(() => {});
          output.error(new Error('local_terminal_stream_stopped'));
        };
        signal.addEventListener('abort', abortStream, { once: true });
        if (signal.aborted) abortStream();
      },
      async pull(output) {
        try {
          const next = await reader.read();
          if (signal.aborted) throw new Error();
          if (next.done) {
            cleanup();
            output.close();
            return;
          }
          size += next.value.byteLength;
          if (size > MAX_RESPONSE) throw new Error();
          output.enqueue(next.value);
        } catch {
          cleanup();
          controller.abort();
          await reader.cancel().catch(() => {});
          output.error(new Error('local_terminal_stream_stopped'));
        }
      },
      async cancel() {
        cleanup();
        controller.abort();
        await reader.cancel().catch(() => {});
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    cleanup();
    controller.abort();
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'local_terminal_model_failed');
  }
}
