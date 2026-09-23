import { recordServiceCheck } from '@repo/db';
import { workerConfig } from './config';

// How often the worker reports itself and checks the provisioning service.
export const HEARTBEAT_INTERVAL_MS = 30_000;

// The worker is seen working when its tick gets here. The provisioning service is asked
// on its health endpoint, on the host the worker delivers provisioning jobs to.
export async function recordHeartbeats(
  request: (url: URL, init: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  await recordServiceCheck('worker', null);
  const url = workerConfig().projectProvisioningUrl;
  if (!url) return;
  const error = await request(new URL('/healthz', url), {
    signal: AbortSignal.timeout(5_000),
  }).then(
    (response) => (response.ok ? null : `HTTP ${response.status}`),
    (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
  );
  await recordServiceCheck('provisioning', error);
}
