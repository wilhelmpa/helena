import { app } from './app';
import { loadExternalServerPlugins } from '#modules/plugins/service';
import { startBackgroundJobs } from './background';
import { warnIfStorageNotConfigured } from '#shared/s3';

// External plugins (HELENA_PLUGINS_DIR) register before the first request, when the
// Administrator switched them on and approved them.
await loadExternalServerPlugins();

// Bind the port. The app itself is assembled in ./app.ts (without `.listen()`)
// so tests can import it and drive routes in memory.
app.listen({
  hostname: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3000),
  // Preview startup waits for readiness before responding (up to 90 seconds).
  idleTimeout: 120,
});

startBackgroundJobs();
warnIfStorageNotConfigured();

console.log(`🦊 API running at http://${app.server?.hostname}:${app.server?.port}`);

export type { App } from './app';
