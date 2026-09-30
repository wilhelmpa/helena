import { realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Access is gated by nginx and the routers; upstream --command requires root locally.
async function startLocalCommand(binary, socket, base, command) {
  if (!path.isAbsolute(socket) || !base.startsWith('/') || !command) {
    throw new Error('A private socket, base path and local command are required');
  }
  const main = await realpath(binary);
  const build = path.dirname(main);
  const require = createRequire(main);
  const [{ server }, { spawn }, { serverDefault }, { setLevel }] = await Promise.all([
    import(pathToFileURL(path.join(build, 'server/socketServer.js')).href),
    import(pathToFileURL(path.join(build, 'server/spawn.js')).href),
    import(pathToFileURL(path.join(build, 'shared/defaults.js')).href),
    import(pathToFileURL(path.join(build, 'shared/logger.js')).href),
  ]);
  setLevel('warn');
  const io = await server(require('express')(), {
    ...serverDefault,
    socket,
    base,
    allowIframe: true,
    allowedOrigins: [],
    allowMissingOrigin: false,
  });
  io.on('connection', (client) => {
    spawn(client, [command]).catch(() => client.disconnect(true));
  });
  const stop = () => {
    io.close(() => rm(socket, { force: true }).finally(() => process.exit(0)));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      wetty: { type: 'string' },
      socket: { type: 'string' },
      base: { type: 'string' },
      command: { type: 'string' },
    },
  });
  await startLocalCommand(values.wetty, values.socket, values.base, values.command);
}
