import { createHmac } from 'node:crypto';

// HMAC-SHA256 over `${timestamp}.${body}` with the webhook's secret, formatted as
// the X-Itsaplan-Signature header value (`t=<ts>,v1=<hex>`). The timestamp lets
// the receiver reject replays; the receiver recomputes the HMAC over the exact
// bytes it received and compares in constant time.
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

// Standard Webhooks (https://www.standardwebhooks.com): `webhook-signature: v1,<base64>`,
// the HMAC-SHA256 over `${id}.${timestamp}.${body}` with the secret's key. A secret is
// `whsec_<key>` and the key is what follows the prefix, base64-decoded, which is how
// every Standard Webhooks library reads it. Sent next to X-Itsaplan-Signature, so a
// receiver can verify with any of those libraries.
export function standardWebhookSignature(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestampSeconds}.${body}`)
    .digest('base64');
  return `v1,${digest}`;
}
