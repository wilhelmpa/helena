import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '@repo/crypto';
import { readSecret, writeSecret } from '@repo/db';

// The secrets of the engine's webhooks, in the Standard Webhooks format (`whsec_` and
// base64): the secret a project's webhook steps sign with, and the secret of a
// workflow's inbound hook. Both are encrypted at rest.

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

function signingKey(projectId: number): string {
  return `helena.workflow-webhook-signing.${projectId}`;
}

// The secret the webhook steps of the project sign with, made the first time it is
// needed.
export async function projectSigningSecret(projectId: number): Promise<string> {
  const stored = await readSecret<{ secret?: string }>(signingKey(projectId));
  if (stored?.secret) return stored.secret;
  const secret = newWebhookSecret();
  await writeSecret(signingKey(projectId), { secret }, { secret: true });
  return secret;
}

export async function rotateProjectSigningSecret(projectId: number): Promise<string> {
  const secret = newWebhookSecret();
  await writeSecret(signingKey(projectId), { secret }, { secret: true });
  return secret;
}

export function sealSecret(secret: string): string {
  return JSON.stringify(encryptSecret(secret));
}

export function openSecret(sealed: string): string {
  return decryptSecret(JSON.parse(sealed) as Parameters<typeof decryptSecret>[0]);
}
