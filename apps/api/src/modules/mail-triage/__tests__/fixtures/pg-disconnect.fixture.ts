import { createConnection, createServer, type Socket } from 'node:net';

// Real PostgreSQL protocol forwarding. Deliberately loses one response after the
// server's ReadyForQuery (committed acquire), or closes before sending a DELETE.
// No SQL result, commit or database state is simulated.
export async function disconnectProxy(
  databaseUrl: string,
  mode: 'acquire-response' | 'release-query' | 'work-query',
) {
  const url = new URL(databaseUrl);
  if (!url.pathname.includes('test') || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Private test DB required');
  const sockets = new Set<Socket>();
  const backendHost = url.hostname.replace(/^\[|\]$/g, '');
  const backendPort = Number(url.port || 5432);
  let fired = false;
  const server = createServer((client) => {
    const backend = createConnection({
      host: backendHost,
      port: backendPort,
    });
    let keepBackend = false;
    for (const socket of [client, backend]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => {
        sockets.delete(socket);
        if (socket === backend || !keepBackend) {
          client.destroy();
          backend.destroy();
        }
      });
    }
    let startup = true;
    let frontend = Buffer.alloc(0);
    let response = Buffer.alloc(0);
    let dropping = false;
    let targetPending = false;
    client.on('data', (bytes) => {
      frontend = Buffer.concat([frontend, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      while (frontend.length >= (startup ? 4 : 5)) {
        const size = startup ? frontend.readUInt32BE(0) : frontend.readUInt32BE(1) + 1;
        if (size > 1024 * 1024) {
          client.destroy();
          return;
        }
        if (frontend.length < size) return;
        const packet = frontend.subarray(0, size);
        frontend = frontend.subarray(size);
        const query =
          !startup && ['P', 'Q'].includes(String.fromCharCode(packet[0]!))
            ? packet.toString().toLowerCase()
            : '';
        const target =
          mode === 'acquire-response'
            ? 'insert into "helena_mail_triage_claim"'
            : mode === 'work-query'
              ? 'update "project"'
              : 'delete from "helena_mail_triage_claim"';
        const type = startup ? '' : String.fromCharCode(packet[0]!);
        if (query.includes(target)) targetPending = true;
        // Parse/Describe may finish with ReadyForQuery before execution. Forward
        // those responses; lose the acknowledgement only after actual Execute.
        if (targetPending && (type === 'E' || type === 'Q')) {
          targetPending = false;
          fired = true;
          if (mode === 'release-query') {
            client.destroy();
            backend.destroy();
            return;
          }
          if (mode === 'work-query') {
            // Only the client dies. The real backend can remain blocked on the
            // test row lock and later commit, even though its caller caught loss.
            keepBackend = true;
            dropping = true;
            backend.write(packet);
            if (type === 'E') backend.write(Buffer.from([83, 0, 0, 0, 4])); // Sync
            client.destroy();
            return;
          }
          dropping = true;
        }
        startup = false;
        backend.write(packet);
      }
    });
    backend.on('data', (bytes) => {
      if (!dropping) {
        client.write(bytes);
        return;
      }
      response = Buffer.concat([response, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      while (response.length >= 5) {
        const size = response.readUInt32BE(1) + 1;
        if (response.length < size) return;
        const type = String.fromCharCode(response[0]!);
        response = response.subarray(size);
        if (type === 'Z' && !keepBackend) {
          client.destroy();
          backend.destroy();
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.HELENA_TRIAGE_PROXY_PORT ?? '0'), '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy did not bind');
  url.hostname = '127.0.0.1';
  url.port = String(address.port);
  url.searchParams.set('sslmode', 'disable');
  return {
    url: url.toString(),
    fired: () => fired,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
