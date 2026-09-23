// Worker tuning, read from the environment once behind a lazy getter so env is
// loaded (via --env-file / the container env) before it is read. Every value has
// a sane default, so the worker runs with only DATABASE_URL set (validated by
// @repo/db's client).

import { intEnv } from './env';
import { readFileSync, lstatSync } from 'node:fs';

function tokenFile(variable: string): string | null {
  const file = process.env[variable]?.trim();
  if (!file) return null;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${variable} must be a private regular file`);
  }
  const token = readFileSync(file, 'utf8').trim();
  if (token.length < 32 || token.length > 2048) {
    throw new Error(`${variable} is invalid`);
  }
  return token;
}

export interface WorkerConfig {
  // How often to poll for due deliveries.
  pollIntervalMs: number;
  // Max deliveries claimed and sent per tick (also the concurrency ceiling).
  batchSize: number;
  // Per-delivery HTTP timeout.
  timeoutMs: number;
  // After this many attempts a failing delivery is marked failed (dead-letter).
  maxAttempts: number;
  // After this many consecutive failures a webhook is auto-disabled.
  disableThreshold: number;
  // How long a claimed row is leased before it becomes claimable again (crash
  // recovery). Must exceed timeoutMs comfortably.
  leaseSeconds: number;
  // Succeeded deliveries older than this are deleted by the periodic cleanup.
  cleanupDays: number;
  // Run the cleanup once every this many ticks.
  cleanupEveryTicks: number;
  projectProvisioningUrl: string | null;
  projectProvisioningToken: string | null;
  // legacy runtime and WebDAV setup can take longer than a regular webhook.
  projectProvisioningTimeoutMs: number;
  // How often the provisioned state is compared with the projects in the database.
  projectReconcileIntervalMs: number;
  // Plan's Mastra control endpoint, where a deleted project's schedules are deleted.
  mastraControlUrl: string | null;
  mastraControlToken: string | null;
}

let cached: WorkerConfig | null = null;

export function workerConfig(): WorkerConfig {
  if (cached) return cached;
  cached = {
    pollIntervalMs: intEnv('WEBHOOK_POLL_INTERVAL_MS', 2000),
    batchSize: intEnv('WEBHOOK_BATCH_SIZE', 20),
    timeoutMs: intEnv('WEBHOOK_TIMEOUT_MS', 10_000),
    maxAttempts: intEnv('WEBHOOK_MAX_ATTEMPTS', 8),
    disableThreshold: intEnv('WEBHOOK_DISABLE_THRESHOLD', 20),
    leaseSeconds: intEnv('WEBHOOK_LEASE_SECONDS', 120),
    cleanupDays: intEnv('WEBHOOK_CLEANUP_DAYS', 30),
    cleanupEveryTicks: intEnv('WEBHOOK_CLEANUP_EVERY_TICKS', 300),
    projectProvisioningUrl: process.env.PROJECT_PROVISIONING_URL?.trim() || null,
    projectProvisioningToken:
      tokenFile('PROJECT_PROVISIONING_TOKEN_FILE') ??
      (process.env.PROJECT_PROVISIONING_TOKEN?.trim() || null),
    projectProvisioningTimeoutMs: intEnv('PROJECT_PROVISIONING_TIMEOUT_MS', 120_000),
    projectReconcileIntervalMs: intEnv('PROJECT_RECONCILE_INTERVAL_MS', 600_000),
    mastraControlUrl: process.env.MASTRA_CONTROL_URL?.trim() || null,
    mastraControlToken: tokenFile('MASTRA_CONTROL_TOKEN_FILE'),
  };
  return cached;
}

export function resetWorkerConfigForTests(): void {
  if (process.env.NODE_ENV === 'production') return;
  cached = null;
}
