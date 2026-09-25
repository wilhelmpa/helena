import type { PushPayload } from './payload';
import type { PushRequest, PushResponse, PushTransport } from './send';

// A fake push service and fake devices for tests: a device holds a real P-256 key pair and
// auth secret like a browser's subscription; the service receives what Helena sends, checks
// the VAPID JWT (RFC 8292) and decrypts the payload (RFC 8291) the way a browser would, with
// WebCrypto and no code of the sender's library.

const text = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  );
}

function fromB64url(value: string): Bytes {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export interface FakeDevice {
  subscription: { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  // RFC 8291 §3.4 and RFC 8188: the plaintext of an aes128gcm body sent to this device.
  decrypt(body: Uint8Array): Promise<string>;
}

export async function fakeDevice(endpoint: string): Promise<FakeDevice> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey: Bytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth: Bytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    subscription: {
      endpoint,
      expirationTime: null,
      keys: { p256dh: b64url(publicKey), auth: b64url(auth) },
    },
    async decrypt(body) {
      const bytes: Bytes = new Uint8Array(body);
      const salt = bytes.slice(0, 16);
      const idLength = bytes[20]!;
      const senderKey = bytes.slice(21, 21 + idLength);
      const ciphertext = bytes.slice(21 + idLength);
      const sender = await crypto.subtle.importKey(
        'raw',
        senderKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256),
      );
      const keyInfo = concat(text.encode('WebPush: info\0'), publicKey, senderKey);
      const ikm = await hkdf(auth, shared, keyInfo, 32);
      const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const padded = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
      );
      let end = padded.length - 1;
      while (end >= 0 && padded[end] === 0) end -= 1;
      if (padded[end] !== 0x02) throw new Error('not the last record of an aes128gcm body');
      return new TextDecoder().decode(padded.slice(0, end));
    },
  };
}

export interface ReceivedPush {
  endpoint: string;
  headers: Record<string, string>;
  payload: PushPayload;
  jwt: { aud: string; exp: number; sub: string };
  vapidKey: string;
}

export interface FakePushService {
  transport: PushTransport;
  received: ReceivedPush[];
  // The answer for the next requests (default 201); a function answers per request.
  answer(status: number | ((endpoint: string) => number), headers?: Record<string, string>): void;
}

async function verifyJwt(authorization: string, endpoint: string) {
  const match = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) throw new Error(`not a VAPID authorization: ${authorization.slice(0, 40)}`);
  const [header, claims, signature] = match[1]!.split('.');
  const key = await crypto.subtle.importKey(
    'raw',
    fromB64url(match[2]!),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromB64url(signature!),
    text.encode(`${header}.${claims}`),
  );
  if (!valid) throw new Error('the VAPID JWT signature does not verify');
  const jwt = JSON.parse(Buffer.from(claims!, 'base64url').toString('utf8')) as {
    aud: string;
    exp: number;
    sub: string;
  };
  if (jwt.aud !== new URL(endpoint).origin) throw new Error(`wrong audience ${jwt.aud}`);
  if (jwt.exp * 1000 < Date.now() || jwt.exp * 1000 > Date.now() + 86_400_000) {
    throw new Error('the JWT expiry is outside 24 hours');
  }
  return { jwt, vapidKey: match[2]! };
}

export function fakePushService(devices: FakeDevice[]): FakePushService {
  const received: ReceivedPush[] = [];
  let status: number | ((endpoint: string) => number) = 201;
  let extra: Record<string, string> = {};
  const transport: PushTransport = async (
    endpoint: string,
    request: PushRequest,
  ): Promise<PushResponse> => {
    const answer = typeof status === 'function' ? status(endpoint) : status;
    if (answer >= 200 && answer < 300) {
      const device = devices.find((entry) => entry.subscription.endpoint === endpoint);
      if (!device) throw new Error(`no fake device at ${endpoint}`);
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
      if (headers['content-encoding'] !== 'aes128gcm') throw new Error('not aes128gcm');
      const { jwt, vapidKey } = await verifyJwt(headers.authorization ?? '', endpoint);
      const payload = JSON.parse(await device.decrypt(request.body)) as PushPayload;
      received.push({ endpoint, headers, payload, jwt, vapidKey });
    }
    return {
      status: answer,
      headers: new Headers(extra),
      text: async () => (answer >= 400 ? `{"reason":"fake ${answer}"}` : ''),
    };
  };
  return {
    transport,
    received,
    answer(next, headers = {}) {
      status = next;
      extra = headers;
    },
  };
}
