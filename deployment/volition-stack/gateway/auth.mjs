import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isIP } from 'node:net';

export function makeAuthenticator(config, keySet) {
  const keys = keySet ?? createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 3600000,
  });
  return async function authenticate(request) {
    const host = request.headers.host?.toLowerCase();
    const route = config.routes[host];
    if (!route) throw new Error('Unknown host');
    const assertion = request.headers['cf-access-jwt-assertion'];
    if (typeof assertion !== 'string' || assertion.length > 16384) throw new Error('Missing assertion');
    const { payload } = await jwtVerify(assertion, keys, {
      issuer: config.issuer,
      audience: route.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
      clockTolerance: 5,
    });
    if (payload.email !== config.ownerEmail || payload.type !== 'app') throw new Error('Identity denied');
    const origin = request.headers.origin;
    if (origin && !route.origins.includes(origin)) throw new Error('Origin denied');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin) throw new Error('Origin required');
    if (request.headers.upgrade && !origin) throw new Error('WebSocket origin required');
    return { route, payload, host };
  };
}

export function trustedHeaders(request, identity) {
  const clientIp = request.headers['cf-connecting-ip'];
  if (typeof clientIp !== 'string' || !isIP(clientIp)) throw new Error('Missing client attribution');
  for (const key of Object.keys(request.headers)) {
    if (/^(?:x-forwarded-|x-auth-|x-remote-|x-real-ip$|x-openclaw-scopes$|remote-user|forwarded$|cf-access-|x-volition-)/i.test(key)) delete request.headers[key];
  }
  if (request.headers.cookie) {
    const cookies = request.headers.cookie.split(';').map(value => value.trim()).filter(value => {
      const name = value.split('=', 1)[0];
      if (/^(?:CF_Authorization|CF_AppSession|CF_BindingCookie|__cf_bm|cf_clearance)$/i.test(name)) return false;
      return identity.route.allowPlanCookies || !name.includes('better-auth.');
    });
    if (cookies.length) request.headers.cookie = cookies.join('; ');
    else delete request.headers.cookie;
  }
  request.headers['x-forwarded-host'] = identity.host;
  request.headers['x-forwarded-proto'] = 'https';
  request.headers['x-forwarded-port'] = '443';
  request.headers['x-forwarded-for'] = clientIp;
  request.headers['x-real-ip'] = clientIp;
  request.headers['x-forwarded-user'] = identity.payload.email;
  request.headers['x-auth-request-email'] = identity.payload.email;
  request.headers['x-volition-auth'] = 'verified';
  if (identity.route.remoteUser) request.headers['remote-user'] = identity.route.remoteUser;
}
