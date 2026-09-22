import { createRemoteJWKSet, jwtVerify } from 'jose';

// This machine-only endpoint accepts Gmail change identifiers, never mail bodies,
// user sessions, arbitrary hooks, or browser-originated requests.
export function makePushAuthenticator(route, keySet) {
  const keys = keySet ?? createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
    timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 3600000,
  });
  return async request => {
    if (request.method !== 'POST' || request.url !== route.path || request.headers.origin) throw new Error('Invalid push request');
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new Error('Invalid content type');
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 16384) throw new Error('Missing push identity');
    const { payload } = await jwtVerify(header.slice(7), keys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: route.audience,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified'], clockTolerance: 5,
    });
    if (payload.email !== route.serviceAccount || payload.email_verified !== true) throw new Error('Push identity denied');
    return payload;
  };
}

export function parsePushBody(value, route) {
  if (!value || value.subscription !== route.subscription || !value.message) throw new Error('Unknown subscription');
  const message = value.message;
  if (typeof message.messageId !== 'string' || !/^\d{1,64}$/.test(message.messageId)) throw new Error('Invalid message id');
  if (typeof message.data !== 'string' || message.data.length > 4096 || !/^[A-Za-z0-9_+/=-]+$/.test(message.data)) throw new Error('Invalid data');
  const data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  if (!route.accounts.includes(data.emailAddress)) throw new Error('Mailbox not allowed');
  const historyId = typeof data.historyId === 'number' && Number.isSafeInteger(data.historyId) && data.historyId >= 0 ? String(data.historyId) : data.historyId;
  if (typeof historyId !== 'string' || !/^\d{1,32}$/.test(historyId)) throw new Error('Invalid mailbox history');
  if (typeof message.publishTime !== 'string' || !Number.isFinite(Date.parse(message.publishTime))) throw new Error('Invalid timestamp');
  return { emailAddress: data.emailAddress, historyId, messageId: message.messageId, publishedAt: new Date(message.publishTime).toISOString() };
}

export async function readPushBody(request) {
  if (Number(request.headers['content-length'] ?? 0) > 16384) throw new Error('Push too large');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Error('Push too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
