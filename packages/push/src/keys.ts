// The VAPID key pair itself (RFC 8292 §3.2: ECDSA on P-256), from WebCrypto: the public key
// as the uncompressed point browsers take as applicationServerKey, the private key as the
// JWK scalar. Storing it is vapid.ts.

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  );
}

// A fresh key pair, from WebCrypto.
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('WebCrypto returned a private key without its scalar');
  return { publicKey: base64url(raw), privateKey: jwk.d };
}
