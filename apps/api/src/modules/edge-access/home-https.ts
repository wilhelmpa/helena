import { checkServerIdentity, connect, type PeerCertificate } from 'node:tls';
import type { HelenaPlugin, HostCapability, HostHealthItem } from '@helena/sdk';
import { homeUrl } from './sign-in';

// The home network's HTTPS (cloudflare/lan_https.py) as a health line on Start and in
// Administrator → Server: nginx on this machine is asked for the home name the way a browser
// at home would (the name as SNI, the chain to a trusted root, the name, the dates), and the
// line turns amber three weeks and red one week before the certificate runs out, or at once
// when it does not hold. certbot renews it a month ahead (certbot.timer), so amber means the
// renewal failed. docs/helena-decisions/security-hardening.md §5.

export const EDGE_PLUGIN_ID = 'helena.edge';
const WARN_DAYS = 21;
const CRITICAL_DAYS = 7;
const CACHE_MS = 10 * 60_000;

export type CertificateProblem = 'expired' | 'name' | 'untrusted' | 'unreachable';

export type CertificateCheck =
  { ok: true; validTo: Date } | { ok: false; problem: CertificateProblem; validTo: Date | null };

export interface CertificateProbeOptions {
  address?: string;
  port?: number;
  timeoutMs?: number;
  // Tests hand in their own root; the live check trusts the runtime's store.
  ca?: string;
}

function problemOf(code: string | undefined): CertificateProblem {
  if (!code) return 'untrusted';
  if (/EXPIRED|NOT_YET_VALID/i.test(code)) return 'expired';
  if (/ALTNAME|HOSTNAME|IP_ADDRESS/i.test(code)) return 'name';
  return 'untrusted';
}

export function probeCertificate(
  host: string,
  { address = '127.0.0.1', port = 443, timeoutMs = 5000, ca }: CertificateProbeOptions = {},
): Promise<CertificateCheck> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CertificateCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = connect({
      host: address,
      port,
      servername: host,
      // Read the certificate even when it does not hold, to say why; decided below.
      rejectUnauthorized: false,
      ...(ca ? { ca } : {}),
    });
    socket.setTimeout(timeoutMs, () =>
      finish({ ok: false, problem: 'unreachable', validTo: null }),
    );
    socket.once('error', () => finish({ ok: false, problem: 'unreachable', validTo: null }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate() as PeerCertificate | undefined;
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      if (!cert || !validTo || Number.isNaN(validTo.valueOf())) {
        finish({ ok: false, problem: 'untrusted', validTo: null });
        return;
      }
      if (validTo.valueOf() <= Date.now()) {
        finish({ ok: false, problem: 'expired', validTo });
        return;
      }
      // The runtime's verdict on the chain, and the name checked here as well.
      const nameError = checkServerIdentity(host, cert);
      if (nameError) {
        finish({ ok: false, problem: 'name', validTo });
        return;
      }
      if (!socket.authorized) {
        const code = String(socket.authorizationError ?? '');
        finish({ ok: false, problem: problemOf(code), validTo });
        return;
      }
      finish({ ok: true, validTo });
    });
  });
}

export function certificateHealth(host: string, check: CertificateCheck, now = Date.now()) {
  const days = check.validTo
    ? Math.max(0, Math.floor((check.validTo.valueOf() - now) / 86_400_000))
    : 0;
  const item: HostHealthItem = check.ok
    ? {
        id: 'https:home',
        state: days <= CRITICAL_DAYS ? 'critical' : days <= WARN_DAYS ? 'attention' : 'ok',
        code: days <= WARN_DAYS ? 'homeHttpsExpiring' : 'homeHttpsOk',
        values: { host, days },
      }
    : {
        id: 'https:home',
        state: 'critical',
        code: 'homeHttpsInvalid',
        values: { host, reason: check.problem },
      };
  return item;
}

let cached: { at: number; host: string; item: HostHealthItem } | null = null;

export const homeHttpsCapability: HostCapability = {
  id: 'helena.edge.home-https',
  label: { i18n: 'server.capabilities.homeHttps' },
  area: 'overview',
  order: 50,
  async probe() {
    return homeUrl()
      ? { available: true }
      : { available: false, reason: 'not_installed', detail: 'HELENA_HOME_URL is not set' };
  },
  async health() {
    const url = homeUrl();
    if (!url) return [];
    const host = new URL(url).hostname;
    if (!cached || cached.host !== host || Date.now() - cached.at > CACHE_MS) {
      cached = {
        at: Date.now(),
        host,
        item: certificateHealth(host, await probeCertificate(host)),
      };
    }
    return [cached.item];
  },
};

export function resetHomeHttpsCacheForTests(): void {
  cached = null;
}

// The internal plugin helena.edge: what the edge (the tunnel, the home network's HTTPS)
// reports about the host.
export const edgePlugin: HelenaPlugin = {
  register(ctx) {
    ctx.hostCapabilities.register(homeHttpsCapability);
  },
};
