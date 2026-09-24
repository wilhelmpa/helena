// The site of the agent acceptance (agent-acceptance.ts, docs/volition-design-browser-perfekt.md
// §5.6): every step of the scenario on pages of their own, checked here on the server — a
// form that must arrive with the right values, a login whose password and TOTP code are
// verified, an upload whose content is checked, a download, a second tab, a dialog. Each run
// lives under its own token (/a/<token>/…); the acceptance script sets what it expects and
// reads what happened through /admin (loopback only, with the admin secret).
import crypto from 'node:crypto';
import http from 'node:http';

const port = Number(process.argv[2] || 18590);
const adminSecret = process.argv[3] || process.env.ACCEPTANCE_ADMIN_SECRET;
if (!adminSecret || adminSecret.length < 16) throw new Error('admin secret missing');

const runs = new Map(); // token -> { expect: {username, password, totpSecret}, events: [] }

function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, at = Date.now(), step = 0) {
  const counter = Math.floor(at / 30_000) + step;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const page = (title, body, script = '') =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body><h1>${title}</h1>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

function readBody(request, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// The one file of a multipart/form-data body: its name and bytes.
function multipartFile(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const name = /filename="([^"]*)"/.exec(head);
    if (name && name[1]) return { name: name[1], bytes: part.subarray(split + 4) };
    start = next;
  }
  return null;
}

const send = (response, status, html, headers = {}) => {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(html);
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname.startsWith('/admin/')) {
        if (request.headers.authorization !== `Bearer ${adminSecret}`)
          return send(response, 401, 'no');
        if (url.pathname === '/admin/expect' && request.method === 'POST') {
          const input = JSON.parse((await readBody(request)).toString('utf8'));
          runs.set(input.token, { expect: input, events: [] });
          return send(response, 200, '{}', { 'content-type': 'application/json' });
        }
        if (url.pathname === '/admin/events') {
          const run = runs.get(url.searchParams.get('token'));
          return send(response, 200, JSON.stringify(run?.events ?? []), {
            'content-type': 'application/json',
          });
        }
        return send(response, 404, 'no');
      }
      const match = /^\/a\/([a-z0-9]{8,64})(\/.*)?$/.exec(url.pathname);
      const run = match ? runs.get(match[1]) : null;
      if (!run) return send(response, 404, page('Unbekannt', '<p>Kein Abnahmelauf</p>'));
      const token = match[1];
      const path = match[2] || '/';
      const record = (name, detail = {}) => run.events.push({ name, at: Date.now(), ...detail });
      const cookie = request.headers.cookie ?? '';
      const loggedIn = cookie.includes(`acc_${token}=password`);

      switch (`${request.method} ${path}`) {
        case 'GET /':
          record('start');
          return send(
            response,
            200,
            page(
              'Abnahme',
              `<ul><li><a href="/a/${token}/form">Formular</a></li><li><a href="/a/${token}/login">Login</a></li>` +
                `<li><a href="/a/${token}/upload">Upload</a></li><li><a href="/a/${token}/download">Download</a></li>` +
                `<li><a href="/a/${token}/dialog">Dialog</a></li></ul>`,
            ),
          );
        case 'GET /form':
          return send(
            response,
            200,
            page(
              'Formular',
              `<form method="post" action="/a/${token}/form">` +
                `<label>Name <input name="name"></label> <label>E-Mail <input name="email" type="email"></label> ` +
                `<label>Farbe <select name="color"><option value="">bitte wählen</option><option>rot</option><option>grün</option><option>blau</option></select></label> ` +
                `<label><input type="checkbox" name="agb"> AGB akzeptiert</label> <button type="submit">Absenden</button></form>`,
            ),
          );
        case 'POST /form': {
          const form = new URLSearchParams((await readBody(request)).toString('utf8'));
          record('form', { values: Object.fromEntries(form) });
          return send(
            response,
            200,
            page('Formular gespeichert', '<p>Danke, das Formular ist angekommen.</p>'),
          );
        }
        case 'GET /login':
          return send(
            response,
            200,
            page(
              'Anmelden',
              `<form method="post" action="/a/${token}/login"><label>Benutzername <input name="user" autocomplete="username"></label> ` +
                `<label>Passwort <input name="pass" type="password" autocomplete="current-password"></label> <button type="submit">Anmelden</button></form>`,
            ),
          );
        case 'POST /login': {
          const form = new URLSearchParams((await readBody(request)).toString('utf8'));
          const ok =
            form.get('user') === run.expect.username && form.get('pass') === run.expect.password;
          record('login', { ok });
          if (!ok)
            return send(
              response,
              200,
              page('Anmeldung fehlgeschlagen', '<p>Benutzername oder Passwort falsch.</p>'),
            );
          return send(response, 303, '', {
            location: `/a/${token}/otp`,
            'set-cookie': `acc_${token}=password; Path=/a/${token}; HttpOnly; SameSite=Lax`,
          });
        }
        case 'GET /otp':
          return send(
            response,
            200,
            page(
              'Zweiter Faktor',
              loggedIn
                ? `<form method="post" action="/a/${token}/otp"><label>Code <input name="otp" autocomplete="one-time-code" inputmode="numeric"></label> <button type="submit">Bestätigen</button></form>`
                : '<p>Bitte zuerst anmelden.</p>',
            ),
          );
        case 'POST /otp': {
          const form = new URLSearchParams((await readBody(request)).toString('utf8'));
          const code = form.get('otp') ?? '';
          const ok =
            loggedIn &&
            [-1, 0, 1].some((step) => totp(run.expect.totpSecret, Date.now(), step) === code);
          record('otp', { ok });
          return send(
            response,
            200,
            page(
              ok ? 'Angemeldet' : 'Code falsch',
              ok ? '<p>Angemeldet mit 2FA.</p>' : '<p>Der Code stimmt nicht.</p>',
            ),
          );
        }
        case 'GET /upload':
          return send(
            response,
            200,
            page(
              'Upload',
              `<form method="post" action="/a/${token}/upload" enctype="multipart/form-data"><label>Datei <input type="file" name="file"></label> <button type="submit">Hochladen</button></form>`,
            ),
          );
        case 'POST /upload': {
          const file = multipartFile(await readBody(request), request.headers['content-type']);
          record(
            'upload',
            file
              ? { fileName: file.name, contains: file.bytes.toString('utf8').includes(token) }
              : { fileName: null },
          );
          return send(
            response,
            200,
            page('Upload', file ? `<p>Datei ${file.name} erhalten.</p>` : '<p>Keine Datei.</p>'),
          );
        }
        case 'GET /download':
          return send(
            response,
            200,
            page('Download', `<a href="/a/${token}/bericht.txt">Bericht herunterladen</a>`),
          );
        case 'GET /bericht.txt':
          record('download');
          response.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'content-disposition': `attachment; filename="abnahme-bericht-${token.slice(0, 8)}.txt"`,
          });
          return response.end(`Abnahmebericht ${token}\n`);
        case 'GET /tab2': {
          const code = `T2-${token.slice(-6).toUpperCase()}`;
          record('tab2');
          return send(
            response,
            200,
            page('Zweiter Tab', `<p>Der Code dieses Tabs lautet ${code}.</p>`),
          );
        }
        case 'GET /dialog':
          return send(
            response,
            200,
            page(
              'Dialog',
              `<button id="b">Löschen</button><p id="r">offen</p>`,
              `document.getElementById('b').onclick = () => { const yes = confirm('Wirklich löschen?'); document.getElementById('r').textContent = yes ? 'gelöscht' : 'abgebrochen'; fetch('/a/${token}/event?name=' + (yes ? 'dialog-accepted' : 'dialog-dismissed')); };`,
            ),
          );
        case 'GET /event':
          record(url.searchParams.get('name') ?? 'event');
          return send(response, 204, '');
        default:
          return send(response, 404, page('Nicht gefunden', ''));
      }
    } catch (error) {
      return send(response, 500, String(error?.message ?? error));
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`acceptance site on http://127.0.0.1:${port}`));
