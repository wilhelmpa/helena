import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushDeliveryMessage } from '@repo/db';
import { UrlNotAllowedError, pinnedFetch } from '@repo/net';
import { pushPayload } from './payload';
import { vapidKeys, vapidSubject } from './vapid';

export { pushPayload, pushTopic, type PushPayload } from './payload';

// Sends one message to one device: the payload encrypted to the device (RFC 8291,
// aes128gcm, padded so its length says nothing), the VAPID JWT (RFC 8292), TTL, urgency and
// topic (RFC 8030 §5), one POST to the device's push service. The encryption and the JWT
// are @block65/webcrypto-web-push (WebCrypto); the request is ours, through the SSRF guard
// every outbound fetch of a stored URL uses, so a subscription can never make Helena call
// an address inside the network.

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  // The push service's HTTP status, when it answered.
  status?: number;
  // The subscription is gone (404/410): remove it, never try it again.
  gone?: boolean;
  // Worth trying again later (a network error, a timeout, 429, 5xx).
  retryable: boolean;
  // Short, without the endpoint: it is a capability URL.
  error?: string;
  // The push service asked to wait this long (Retry-After on a 429 or 503).
  retryAfterMs?: number;
}

export interface PushRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
}

export interface PushResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
}

export type PushTransport = (endpoint: string, request: PushRequest) => Promise<PushResponse>;

const TIMEOUT_MS = 15_000;

export const guardedTransport: PushTransport = (endpoint, request) =>
  pinnedFetch(endpoint, {
    method: request.method,
    headers: request.headers,
    body: Buffer.from(request.body),
    timeoutMs: request.timeoutMs,
    maxBytes: 4096,
    truncateBody: true,
  });

let transport: PushTransport = guardedTransport;

// Tests hand in a fake push service; null restores the guarded one.
export function usePushTransport(next: PushTransport | null): void {
  transport = next ?? guardedTransport;
}

function retryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 86_400) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 86_400_000)) : undefined;
}

export async function sendWebPush(
  target: PushTarget,
  message: PushDeliveryMessage,
): Promise<PushSendResult> {
  let url: URL;
  try {
    url = new URL(target.endpoint);
  } catch {
    return { ok: false, gone: true, retryable: false, error: 'invalid endpoint' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, gone: true, retryable: false, error: 'endpoint is not https' };
  }
  let request: PushRequest;
  try {
    const keys = await vapidKeys();
    const built = await buildPushPayload(
      {
        data: JSON.stringify(pushPayload(message)),
        options: { ttl: Math.max(0, Math.round(message.ttlSeconds)) },
      },
      {
        endpoint: target.endpoint,
        expirationTime: null,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      { subject: await vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
    );
    const headers: Record<string, string> = { ...built.headers, urgency: message.urgency };
    if (message.topic) headers.topic = message.topic;
    request = { method: 'POST', headers, body: built.body, timeoutMs: TIMEOUT_MS };
  } catch (error) {
    // A device key that is not a P-256 point, an auth secret of the wrong size: the
    // subscription can never be pushed to.
    return {
      ok: false,
      retryable: false,
      error: `could not encrypt: ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        200,
      ),
    };
  }

  let response: PushResponse;
  try {
    response = await transport(target.endpoint, request);
  } catch (error) {
    if (error instanceof UrlNotAllowedError) {
      return { ok: false, gone: true, retryable: false, error: `endpoint refused: ${error.code}` };
    }
    return {
      ok: false,
      retryable: true,
      error: (error instanceof Error ? error.message : 'push request failed').slice(0, 200),
    };
  }
  const status = response.status;
  if (status >= 200 && status < 300) return { ok: true, status, retryable: false };
  const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
  const error = `HTTP ${status}${body ? `: ${body}` : ''}`;
  if (status === 404 || status === 410)
    return { ok: false, status, gone: true, retryable: false, error };
  if (status === 429 || status >= 500) {
    const wait = retryAfter(response.headers);
    return {
      ok: false,
      status,
      retryable: true,
      error,
      ...(wait !== undefined ? { retryAfterMs: wait } : {}),
    };
  }
  // 400 (a header the service refuses), 401/403 (a JWT or key it refuses: a subscription of
  // another VAPID key), 413 (too big): the same message would fail the same way again.
  return { ok: false, status, retryable: false, error };
}
