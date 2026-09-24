// The runtime an agent runs on: its runtime policy's, Hermes when it names none. Findings about
// models are recorded per runtime (service.ts).
export function runtimeOfPolicy(policy: unknown): string {
  const runtime =
    policy && typeof policy === 'object' ? (policy as { runtime?: unknown }).runtime : undefined;
  return typeof runtime === 'string' && runtime.trim() ? runtime.trim() : 'hermes';
}
