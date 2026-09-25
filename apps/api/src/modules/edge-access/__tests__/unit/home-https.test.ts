import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { certificateHealth, probeCertificate } from '../../home-https';

// The home network's certificate check against a real TLS listener: a throw-away CA and a
// certificate for home.example.test, made with openssl for this run (no key in the repo).

const HOST = 'home.example.test';
const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'home-https-'));
const openssl = (args: string[], input?: string) =>
  execFileSync('openssl', args, { cwd: work, input, stdio: ['pipe', 'pipe', 'pipe'] });

let server: Server;
let port = 0;
let ca = '';

beforeAll(async () => {
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  openssl([
    ...['req', '-x509', ...ec, '-days', '2', '-subj', '/CN=Helena Test CA'],
    ...['-keyout', 'ca.key', '-out', 'ca.crt', '-addext', 'basicConstraints=critical,CA:TRUE'],
    ...['-addext', 'keyUsage=critical,keyCertSign'],
  ]);
  openssl(['req', ...ec, '-subj', `/CN=${HOST}`, '-keyout', 'leaf.key', '-out', 'leaf.csr']);
  openssl(
    [
      ...['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key'],
      ...['-CAcreateserial', '-days', '40', '-out', 'leaf.crt', '-extfile', '/dev/stdin'],
    ],
    `subjectAltName=DNS:${HOST}\n`,
  );
  ca = readFileSync(join(work, 'ca.crt'), 'utf8');
  server = createServer({
    key: readFileSync(join(work, 'leaf.key')),
    cert: readFileSync(join(work, 'leaf.crt')),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

describe('the home network certificate check', () => {
  it('accepts a certificate for the name from a trusted root, with its end date', async () => {
    const check = await probeCertificate(HOST, { port, ca });
    expect(check.ok).toBe(true);
    const days = (check.validTo!.valueOf() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(38);
    expect(days).toBeLessThan(41);
  });

  it('says why a certificate does not hold', async () => {
    expect(await probeCertificate('other.example.test', { port, ca })).toMatchObject({
      ok: false,
      problem: 'name',
    });
    expect(await probeCertificate(HOST, { port })).toMatchObject({
      ok: false,
      problem: 'untrusted',
    });
  });

  it('reports a closed port as unreachable', async () => {
    const closed = createServer({});
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const free = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await probeCertificate(HOST, { port: free, timeoutMs: 2000 })).toEqual({
      ok: false,
      problem: 'unreachable',
      validTo: null,
    });
  });
});

describe('the health line', () => {
  const now = Date.UTC(2026, 8, 25);
  const inDays = (days: number) => new Date(now + days * 86_400_000 + 3600_000);

  it('is quiet with more than three weeks left', () => {
    expect(certificateHealth(HOST, { ok: true, validTo: inDays(60) }, now)).toMatchObject({
      id: 'https:home',
      state: 'ok',
      code: 'homeHttpsOk',
      values: { host: HOST, days: 60 },
    });
  });

  it('turns amber at three weeks and red at one', () => {
    expect(certificateHealth(HOST, { ok: true, validTo: inDays(20) }, now)).toMatchObject({
      state: 'attention',
      code: 'homeHttpsExpiring',
      values: { days: 20 },
    });
    expect(certificateHealth(HOST, { ok: true, validTo: inDays(6) }, now)).toMatchObject({
      state: 'critical',
      code: 'homeHttpsExpiring',
    });
  });

  it('is red with the reason when the certificate does not hold', () => {
    expect(
      certificateHealth(HOST, { ok: false, problem: 'expired', validTo: inDays(-1) }, now),
    ).toMatchObject({
      state: 'critical',
      code: 'homeHttpsInvalid',
      values: { host: HOST, reason: 'expired' },
    });
  });
});
