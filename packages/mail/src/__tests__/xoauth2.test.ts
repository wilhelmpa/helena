import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { testImapConnection, testSmtpConnection, type MailServerSettings } from '../servers';

// A Google account's mailbox signs in to IMAP and SMTP with its OAuth access token (SASL
// XOAUTH2) instead of a password. Fake servers over TLS record what the client sent.

interface Login {
  protocol: 'imap' | 'smtp';
  method: string;
  user?: string;
  token?: string;
}

const TOKEN = 'ya29.test-access-token';

// The SASL XOAUTH2 initial response: "user=<address>^Aauth=Bearer <token>^A^A".
function xoauth2(payload: string): { user?: string; token?: string } {
  const fields = Buffer.from(payload, 'base64').toString('utf8').split(String.fromCharCode(1));
  const user = fields.find((field) => field.startsWith('user='))?.slice('user='.length);
  const token = fields
    .find((field) => field.startsWith('auth=Bearer '))
    ?.slice('auth=Bearer '.length);
  return { user, token };
}

let dir: string;
let imap: tls.Server;
let smtp: tls.Server;
let imapPort = 0;
let smtpPort = 0;
const logins: Login[] = [];
const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

function lines(socket: tls.TLSSocket, onLine: (line: string) => void) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index: number;
    while ((index = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      onLine(line);
    }
  });
  socket.on('error', () => undefined);
}

function listen(server: tls.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, () => resolve((server.address() as { port: number }).port)),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'xoauth2-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const options = {
    key: readFileSync(join(dir, 'key.pem')),
    cert: readFileSync(join(dir, 'cert.pem')),
  };
  // The fake servers' certificate is self-signed.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  imap = tls.createServer(options, (socket) => {
    socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=XOAUTH2 AUTH=PLAIN SASL-IR] ready\r\n');
    let pending: string | null = null;
    lines(socket, (line) => {
      if (pending) {
        const tag = pending;
        pending = null;
        logins.push({ protocol: 'imap', method: 'XOAUTH2', ...xoauth2(line) });
        socket.write(`${tag} OK authenticated\r\n`);
        return;
      }
      const [tag, command = '', ...rest] = line.split(' ');
      const verb = command.toUpperCase();
      if (verb === 'AUTHENTICATE' && rest[0]?.toUpperCase() === 'XOAUTH2') {
        if (rest[1]) {
          const login = xoauth2(rest[1]);
          logins.push({ protocol: 'imap', method: 'XOAUTH2', ...login });
          socket.write(
            login.token === TOKEN
              ? `${tag} OK [CAPABILITY IMAP4rev1] authenticated\r\n`
              : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`,
          );
        } else {
          pending = tag!;
          socket.write('+ \r\n');
        }
      } else if (verb === 'LOGIN') {
        logins.push({ protocol: 'imap', method: 'LOGIN', user: rest[0]?.replace(/"/g, '') });
        socket.write(`${tag} OK logged in\r\n`);
      } else if (verb === 'CAPABILITY') {
        socket.write(`* CAPABILITY IMAP4rev1 AUTH=XOAUTH2 SASL-IR\r\n${tag} OK done\r\n`);
      } else if (verb === 'NAMESPACE') {
        socket.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK done\r\n`);
      } else if (verb === 'LOGOUT') {
        socket.end(`* BYE\r\n${tag} OK bye\r\n`);
      } else {
        socket.write(`${tag} OK done\r\n`);
      }
    });
  });

  smtp = tls.createServer(options, (socket) => {
    socket.write('220 fake ESMTP ready\r\n');
    lines(socket, (line) => {
      const [verb = '', method, payload] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          socket.write('250-fake\r\n250 AUTH XOAUTH2 PLAIN LOGIN\r\n');
          break;
        case 'AUTH':
          if (method === 'XOAUTH2') {
            const login = xoauth2(payload ?? '');
            logins.push({ protocol: 'smtp', method: 'XOAUTH2', ...login });
            socket.write(
              login.token === TOKEN ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Bad credentials\r\n',
            );
          } else {
            logins.push({ protocol: 'smtp', method: method ?? '' });
            socket.write('235 2.7.0 Accepted\r\n');
          }
          break;
        case 'QUIT':
          socket.end('221 bye\r\n');
          break;
        default:
          socket.write('250 ok\r\n');
      }
    });
  });
  imapPort = await listen(imap);
  smtpPort = await listen(smtp);
});

afterAll(() => {
  imap?.close();
  smtp?.close();
  if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
  rmSync(dir, { recursive: true, force: true });
});

function settings(auth: Partial<MailServerSettings>): MailServerSettings {
  return {
    imapHost: 'localhost',
    imapPort,
    imapTls: true,
    smtpHost: 'localhost',
    smtpPort,
    smtpTls: true,
    username: 'owner@example.com',
    ...auth,
  };
}

describe('XOAUTH2', () => {
  it('signs in to IMAP and SMTP with the access token and no password', async () => {
    logins.length = 0;
    expect(await testImapConnection(settings({ accessToken: TOKEN }))).toBeNull();
    expect(await testSmtpConnection(settings({ accessToken: TOKEN }))).toBeNull();
    expect(logins).toEqual([
      { protocol: 'imap', method: 'XOAUTH2', user: 'owner@example.com', token: TOKEN },
      { protocol: 'smtp', method: 'XOAUTH2', user: 'owner@example.com', token: TOKEN },
    ]);
  });

  it('reports a refused token without repeating it', async () => {
    const imapError = await testImapConnection(settings({ accessToken: 'ya29.revoked' }));
    const smtpError = await testSmtpConnection(settings({ accessToken: 'ya29.revoked' }));
    expect(imapError).toBeTruthy();
    expect(smtpError).toBeTruthy();
    expect(`${imapError} ${smtpError}`).not.toContain('ya29.revoked');
  });

  it('still logs in with a password where there is no token', async () => {
    logins.length = 0;
    expect(await testImapConnection(settings({ password: 'app-password' }))).toBeNull();
    expect(await testSmtpConnection(settings({ password: 'app-password' }))).toBeNull();
    expect(logins.map((login) => `${login.protocol}:${login.method}`)).not.toContain(
      'imap:XOAUTH2',
    );
    expect(logins.map((login) => `${login.protocol}:${login.method}`)).not.toContain(
      'smtp:XOAUTH2',
    );
  });
});
