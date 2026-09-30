import { readFileSync } from 'node:fs';
import { chmod, chown, mkdir, unlink } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  DEFAULT_PRIORITY_CONFIG,
  type PriorityConfig,
} from '../../../../packages/sdk/src/halogen-priority';
import { PriorityScheduler, type PriorityClass } from './priority-scheduler';

export const PRIORITY_HEADER = 'x-volition-halogen-priority';

export interface ProxyOptions {
  hostPorts: [number, number];
  backendPorts: [number, number];
  socketDir: string;
  socketGroup?: number;
  readConfig?: () => Promise<PriorityConfig>;
  refreshMs?: number;
  healthCheck?: boolean;
  maintenancePath?: string;
}

type RequestClass = PriorityClass | 'voice-reply';

function priority(value: string | string[] | undefined): RequestClass {
  return value === 'interactive' ||
    value === 'realtime' ||
    value === 'background' ||
    value === 'voice-reply'
    ? value
    : 'normal';
}

function unavailable(response: ServerResponse, reason: 'busy' | 'backend_unavailable'): void {
  if (response.destroyed) return;
  response.writeHead(reason === 'busy' ? 503 : 502, {
    'content-type': 'application/json',
    ...(reason === 'busy' ? { 'retry-after': '1' } : {}),
  });
  response.end(
    JSON.stringify({
      error: {
        code: reason === 'busy' ? 'engine_busy' : 'backend_unavailable',
        message:
          reason === 'busy'
            ? 'Halogen queue is full or timed out'
            : 'Halogen backend is unavailable',
      },
    }),
  );
}

export async function startPriorityProxy(options: ProxyOptions) {
  const scheduler = new PriorityScheduler();
  scheduler.admissionCheck = () => {
    try {
      const value = JSON.parse(
        readFileSync(
          options.maintenancePath ?? '/var/lib/volition/model-maintenance/state.json',
          'utf8',
        ),
      );
      return value.version !== 1 || value.proxyPaused !== false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  };
  const maintenanceTimer = setInterval(() => scheduler.setAdministrativePaused(false), 100);
  const servers: ReturnType<typeof createServer>[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let healthTimer: ReturnType<typeof setTimeout> | undefined;
  const activeStreams = new Map<IncomingMessage, number>();
  let closed = false;
  const refresh = async () => {
    if (!options.readConfig) return;
    try {
      scheduler.setConfig(await options.readConfig());
    } catch (error) {
      console.error('[halogen-priority] policy refresh failed', error);
    }
  };
  await refresh();
  if (options.readConfig) {
    refreshTimer = setInterval(() => void refresh(), options.refreshMs ?? 5_000);
  }
  const probe = async () => {
    const timeoutMs = scheduler.status().config.healthTimeoutMs;
    try {
      const healthy = await Promise.all(
        options.backendPorts.map(
          (port) =>
            new Promise<boolean>((resolve) => {
              const check = request(
                { hostname: '127.0.0.1', port, path: '/health', method: 'GET' },
                (response) => {
                  response.resume();
                  resolve((response.statusCode ?? 500) < 500);
                },
              );
              // Bun does not always emit error after destroy(): resolve here and on close, so a
              // slow /health never leaves the probe pending (and the proxy paused) for good.
              check.setTimeout(timeoutMs, () => {
                resolve(false);
                check.destroy();
              });
              check.on('error', () => resolve(false));
              check.on('close', () => resolve(false));
              check.end();
            }),
        ),
      );
      const streamActive = [...activeStreams.values()].some(
        (lastData) => Date.now() - lastData < scheduler.status().config.upstreamIdleMs,
      );
      if (!closed) scheduler.recordHealthProbe(healthy.every(Boolean) || streamActive);
    } finally {
      if (!closed)
        healthTimer = setTimeout(() => void probe(), scheduler.status().config.healthProbeMs);
    }
  };
  if (options.healthCheck ?? options.hostPorts[0] !== 0) void probe();

  const handler =
    (backendPort: number, fixedClass?: PriorityClass) =>
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      if (!fixedClass && incoming.url === '/priority/status' && incoming.method === 'GET') {
        outgoing.setHeader('content-type', 'application/json');
        outgoing.setHeader('cache-control', 'no-store');
        const status = scheduler.status();
        outgoing.end(
          JSON.stringify({
            ...status,
            maxTokensByClass: {
              interactive: null,
              'voice-reply': status.config.voiceReplyMaxTokens,
              realtime: status.config.realtimeMaxTokens,
              normal: null,
              background: null,
            },
          }),
        );
        return;
      }
      const requestClass = fixedClass ?? priority(incoming.headers[PRIORITY_HEADER]);
      const kind = requestClass === 'voice-reply' ? 'interactive' : requestClass;
      const scheduled = incoming.method === 'POST';
      const disconnected = new AbortController();
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) disconnected.abort();
      });
      const admission = scheduled
        ? await scheduler.acquireWithReason(kind, disconnected.signal)
        : { release: () => {} };
      const { release } = admission;
      if (!release) {
        if (!disconnected.signal.aborted && admission.reason !== 'aborted')
          unavailable(outgoing, admission.reason!);
        return;
      }
      if (disconnected.signal.aborted) {
        release();
        return;
      }
      const headers = { ...incoming.headers };
      delete headers[PRIORITY_HEADER];
      delete headers.connection;
      const tokenLimit =
        requestClass === 'realtime'
          ? scheduler.status().config.realtimeMaxTokens
          : requestClass === 'voice-reply'
            ? scheduler.status().config.voiceReplyMaxTokens
            : null;
      let body: Buffer | undefined;
      let nonStreaming = false;
      if (
        scheduled &&
        /\/chat\/completions(?:\?|$)/.test(incoming.url ?? '') &&
        String(incoming.headers['content-type'] ?? '').includes('application/json')
      ) {
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of incoming) {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            size += part.length;
            if (tokenLimit && size > 2_000_000) throw new Error('request_too_large');
            chunks.push(part);
          }
          body = Buffer.concat(chunks);
          const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
          nonStreaming = parsed.stream !== true;
          if (tokenLimit) {
            const key = 'max_completion_tokens' in parsed ? 'max_completion_tokens' : 'max_tokens';
            const requested = parsed[key];
            parsed[key] =
              typeof requested === 'number' && Number.isFinite(requested)
                ? Math.max(1, Math.min(Math.floor(requested), tokenLimit))
                : tokenLimit;
            body = Buffer.from(JSON.stringify(parsed));
          }
          delete headers['transfer-encoding'];
          headers['content-length'] = String(body.length);
        } catch {
          release();
          if (!outgoing.destroyed) {
            outgoing.writeHead(400);
            outgoing.end();
          }
          return;
        }
      }
      if (disconnected.signal.aborted) {
        release();
        return;
      }
      const upstream = request({
        hostname: '127.0.0.1',
        port: backendPort,
        path: incoming.url,
        method: incoming.method,
        headers,
      });
      let done = false;
      let generationTimer: ReturnType<typeof setTimeout> | undefined;
      if (nonStreaming) {
        upstream.setTimeout(0);
        upstream.once('finish', () => {
          if (!done)
            generationTimer = setTimeout(() => {
              upstream.destroy(new Error('non_streaming_timeout'));
            }, scheduler.status().config.nonStreamingTimeoutMs);
        });
      } else {
        upstream.setTimeout(scheduler.status().config.upstreamIdleMs, () => {
          upstream.destroy(new Error('upstream_idle_timeout'));
        });
      }
      const finish = () => {
        if (done) return;
        done = true;
        if (generationTimer) clearTimeout(generationTimer);
        release();
      };
      upstream.on('close', finish);
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) upstream.destroy();
      });
      upstream.on('response', (response) => {
        if (
          (response.statusCode ?? 500) < 500 &&
          String(response.headers['content-type'] ?? '').includes('text/event-stream')
        ) {
          response.on('data', (chunk: Buffer) => {
            if (chunk.length === 0) return;
            activeStreams.set(response, Date.now());
            scheduler.recordHealthProbe(true);
          });
          response.on('close', () => activeStreams.delete(response));
          response.on('end', () => activeStreams.delete(response));
        }
        if ((response.statusCode ?? 500) >= 500 && (kind === 'interactive' || kind === 'realtime'))
          scheduler.recordFallback(kind);
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
        response.on('close', finish);
        response.on('end', finish);
      });
      upstream.on('error', () => {
        if (kind === 'interactive' || kind === 'realtime') scheduler.recordFallback(kind);
        finish();
        if (!outgoing.headersSent && !outgoing.destroyed) {
          outgoing.writeHead(502, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ error: { code: 'backend_unavailable' } }));
        } else if (!outgoing.destroyed) outgoing.destroy();
      });
      // A request without a body (GET /v1/models, /health) is sent at once: Bun does not
      // always end an empty IncomingMessage, so piping it would never send the request.
      const hasBody =
        Boolean(incoming.headers['transfer-encoding']) ||
        Number(incoming.headers['content-length'] ?? 0) > 0;
      if (body) upstream.end(body);
      else if (!hasBody) upstream.end();
      else incoming.pipe(upstream);
    };

  const listen = async (server: ReturnType<typeof createServer>, address: number | string) => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      const ready = () => {
        server.off('error', reject);
        resolve();
      };
      if (typeof address === 'number') server.listen(address, '127.0.0.1', ready);
      else server.listen(address, ready);
    });
    servers.push(server);
  };
  try {
    await mkdir(options.socketDir, { recursive: true, mode: 0o755 });
    for (const [index, suffix] of ['8731', '8733'].entries()) {
      const backendPort = options.backendPorts[index]!;
      await listen(createServer(handler(backendPort)), options.hostPorts[index]!);
      for (const [name, kind] of [
        ['normal', 'normal'],
        ['chat', 'interactive'],
        ['realtime', 'realtime'],
        ['background', 'background'],
      ] as const) {
        const path = join(options.socketDir, `${name}-${suffix}.sock`);
        await unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await listen(createServer(handler(backendPort, kind)), path);
        await chmod(path, 0o660);
        if (options.socketGroup !== undefined) {
          const uid = process.getuid?.();
          if (uid === undefined) throw new Error('Unix socket ownership requires a Unix host');
          await chown(path, uid, options.socketGroup);
        }
      }
    }
  } catch (error) {
    closed = true;
    clearInterval(maintenanceTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    if (healthTimer) clearTimeout(healthTimer);
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    throw error;
  }
  return {
    scheduler,
    ports: servers
      .filter((_, index) => index === 0 || index === 5)
      .map((server) => {
        const address = server.address();
        return typeof address === 'object' && address ? address.port : null;
      }),
    async close() {
      closed = true;
      clearInterval(maintenanceTimer);
      if (refreshTimer) clearInterval(refreshTimer);
      if (healthTimer) clearTimeout(healthTimer);
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    },
  };
}

if (import.meta.main) {
  const { readLocalAiPolicy } = await import('../../../../packages/db/src/domains/local-ai');
  const group = Number(process.env.VOLITION_AGENTS_GID);
  await startPriorityProxy({
    hostPorts: [8741, 8743],
    backendPorts: [8731, 8733],
    socketDir: '/run/volition-halogen-priority',
    socketGroup: Number.isInteger(group) ? group : undefined,
    readConfig: async () => (await readLocalAiPolicy()).halogenPriority ?? DEFAULT_PRIORITY_CONFIG,
  });
}
