import { chmod, chown, mkdir, unlink } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DEFAULT_PRIORITY_CONFIG, type PriorityConfig } from '../../../../packages/sdk/src/halogen-priority';
import { PriorityScheduler, type PriorityClass } from './priority-scheduler';

export const PRIORITY_HEADER = 'x-volition-halogen-priority';

export interface ProxyOptions {
  hostPorts: [number, number];
  backendPorts: [number, number];
  socketDir: string;
  socketGroup?: number;
  readConfig?: () => Promise<PriorityConfig>;
  refreshMs?: number;
}

function priority(value: string | string[] | undefined): PriorityClass {
  return value === 'interactive' || value === 'background' ? value : 'normal';
}

function unavailable(response: ServerResponse, timeoutMs: number): void {
  if (response.destroyed) return;
  response.writeHead(503, {
    'content-type': 'application/json',
    'retry-after': String(Math.max(1, Math.ceil(timeoutMs / 1000))),
  });
  response.end(JSON.stringify({ error: { code: 'engine_busy', message: 'Halogen queue is full or timed out' } }));
}

export async function startPriorityProxy(options: ProxyOptions) {
  const scheduler = new PriorityScheduler();
  const servers: ReturnType<typeof createServer>[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
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

  const handler = (backendPort: number, fixedClass?: PriorityClass) =>
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      if (!fixedClass && incoming.url === '/priority/status' && incoming.method === 'GET') {
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify(scheduler.status()));
        return;
      }
      const kind = fixedClass ?? priority(incoming.headers[PRIORITY_HEADER]);
      const scheduled = incoming.method === 'POST';
      const disconnected = new AbortController();
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) disconnected.abort();
      });
      const release = scheduled ? await scheduler.acquire(kind, disconnected.signal) : () => {};
      if (!release) {
        if (!disconnected.signal.aborted) unavailable(outgoing, scheduler.status().config.queueTimeoutMs);
        return;
      }
      if (disconnected.signal.aborted) {
        release();
        return;
      }
      const headers = { ...incoming.headers };
      delete headers[PRIORITY_HEADER];
      delete headers.connection;
      const upstream = request({
        hostname: '127.0.0.1',
        port: backendPort,
        path: incoming.url,
        method: incoming.method,
        headers,
      });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        release();
      };
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) upstream.destroy();
      });
      upstream.on('response', (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
        response.on('close', finish);
        response.on('end', finish);
      });
      upstream.on('error', () => {
        finish();
        if (!outgoing.headersSent && !outgoing.destroyed) {
          outgoing.writeHead(502, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ error: { code: 'backend_unavailable' } }));
        } else if (!outgoing.destroyed) outgoing.destroy();
      });
      incoming.pipe(upstream);
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
    if (refreshTimer) clearInterval(refreshTimer);
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    throw error;
  }
  return {
    scheduler,
    ports: servers.filter((_, index) => index === 0 || index === 4).map((server) => {
      const address = server.address();
      return typeof address === 'object' && address ? address.port : null;
    }),
    async close() {
      if (refreshTimer) clearInterval(refreshTimer);
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
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
