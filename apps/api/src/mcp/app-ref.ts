import type { McpApp } from './types';

// The assembled app, captured once at the composition root (app.ts), for the modules
// that dispatch requests against the real routes in process (see dispatch.ts) but are
// themselves mounted by the app, so a direct import would close a cycle: the template
// bundles. The reference is set at startup instead.

let current: McpApp | null = null;

export function setMcpApp(app: McpApp): void {
  current = app;
}

// Throws when called before startup wired the reference, which is a programming
// error rather than a runtime condition (app.ts sets it as the app is assembled).
export function getMcpApp(): McpApp {
  if (!current) throw new Error('App reference is not set — setMcpApp() must run at startup');
  return current;
}
