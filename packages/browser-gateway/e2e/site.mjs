// The test site of the gateway's end-to-end check (run.sh): every page an agent's tools have
// to handle, on two origins (the second one serves the iframe login). Pages report what
// happened in their own text, so the check reads it through browser_snapshot like an agent.
import http from 'node:http';

const [portA, portB] = [Number(process.argv[2] || 18566), Number(process.argv[3] || 18567)];
const page = (title, body, script = '') =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body><h1>${title}</h1>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const loginForm = (action) => `
  <form method="post" action="${action}">
    <label>Benutzername <input name="user" autocomplete="username"></label>
    <label>Passwort <input id="pw" name="pass" type="password" autocomplete="current-password"></label>
    <button type="button" id="show">Passwort anzeigen</button>
    <button type="submit">Anmelden</button>
  </form>`;
const showToggle = `document.getElementById('show').onclick = () => {
  const pw = document.getElementById('pw'); pw.type = pw.type === 'password' ? 'text' : 'password'; };`;

function body(request) {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(new URLSearchParams(data)));
  });
}

const pagesA = {
  '/': () => page('Start', '<a href="/login">Login</a> <a href="/upload">Upload</a>'),
  '/login': () => page('Login', loginForm('/welcome'), showToggle),
  '/otp': () =>
    page(
      'Code',
      '<label>Code <input name="otp" autocomplete="one-time-code"></label><button id="go">Prüfen</button><p id="r"></p>',
      `document.getElementById('go').onclick = () => { const v = document.querySelector('[name=otp]').value;
        document.getElementById('r').textContent = /^\\d{6}$/.test(v) ? 'Code angenommen' : 'Code falsch'; };`,
    ),
  '/frame': () =>
    page(
      'Frame',
      `<p>Anmeldung im Rahmen:</p><iframe src="http://127.0.0.1:${portB}/login-frame" width="500" height="260"></iframe>`,
    ),
  '/upload': () =>
    page(
      'Upload',
      '<label>Datei <input type="file" id="f"></label><p id="r">keine Datei</p>',
      `document.getElementById('f').onchange = (e) => { const f = e.target.files[0];
        document.getElementById('r').textContent = 'Gewählt: ' + f.name + ' (' + f.size + ' Bytes)'; };`,
    ),
  // An upload button that opens the file chooser (a hidden input behind it).
  '/upload2': () =>
    page(
      'Upload per Knopf',
      '<button id="pick">Dateien wählen</button><input type="file" id="f2" multiple hidden><p id="r">keine Datei</p>',
      `document.getElementById('pick').onclick = () => document.getElementById('f2').click();
       document.getElementById('f2').onchange = (e) => { document.getElementById('r').textContent = 'Gewählt: ' + [...e.target.files].map((f) => f.name + ' (' + f.size + ' Bytes)').join(', '); };`,
    ),
  '/form': () =>
    page(
      'Formular',
      `<label>Name <input id="name" value="alter Wert"></label>
       <label><input type="checkbox" id="agb"> AGB</label>
       <label>Farbe <select id="farbe"><option>rot</option><option>grün</option><option>blau</option></select></label>
       <label>Menge <input type="range" id="menge" min="0" max="10" value="1"></label>
       <button id="send">Senden</button><p id="r">nichts gesendet</p>`,
      `document.getElementById('send').onclick = () => { const v = (id) => document.getElementById(id);
         v('r').textContent = 'Gesendet: name=' + v('name').value + ' agb=' + v('agb').checked + ' farbe=' + v('farbe').value + ' menge=' + v('menge').value; };`,
    ),
  // Content that arrives later, for browser_wait_for.
  '/later': () =>
    page(
      'Später',
      '<p id="s">Lädt …</p>',
      `setTimeout(() => { document.getElementById('s').textContent = 'Fertig geladen'; }, 1500);`,
    ),
  // A page whose snapshot is cut off, for browser_find.
  '/long': () =>
    page(
      'Lang',
      `<ul>${Array.from({ length: 2500 }, (_, i) => `<li>Eintrag Nummer ${i} mit etwas Text</li>`).join('')}</ul><button>Nadel im Heuhaufen</button>`,
    ),
  '/download': () => page('Download', '<a href="/report.txt">Bericht herunterladen</a>'),
  '/dialog': () =>
    page(
      'Dialog',
      '<button id="b">Löschen</button><p id="r">offen</p>',
      `document.getElementById('b').onclick = () => { document.getElementById('r').textContent = confirm('Wirklich löschen?') ? 'gelöscht' : 'abgebrochen'; };`,
    ),
  '/popup': () => page('Popup', '<a href="/" target="_blank">Neues Fenster</a>'),
  '/blocked-link': () =>
    page('Link', `<a href="http://localhost:${portA}/">Zur gesperrten Seite</a>`),
  '/token': () =>
    page('Token', '<p>Seite mit Token in der Adresse</p>', "console.log('token page ready')"),
  // Bot signals, read by the page itself in its own world: navigator.webdriver, globals a
  // CDP client leaves (bindings, init scripts), and whether anything but the page changed its
  // DOM (the gateway must never write into a page).
  '/leaks': () =>
    page(
      'Leaks',
      '<button id="report">Bericht</button><p id="r">läuft</p>',
      `let mutations = 0; let own = false;
       new MutationObserver((list) => { if (!own) mutations += list.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
       document.getElementById('report').onclick = () => {
         const globals = Object.keys(window).filter((k) => /^(__playwright|__pw|__puppeteer|cdc_|__driver|__webdriver|__selenium)/.test(k));
         const stack = new Error('probe').stack || '';
         const traces = /__puppeteer_evaluation_script__|__playwright_evaluation_script__/.test(stack);
         own = true;
         document.getElementById('r').textContent = 'webdriver=' + navigator.webdriver + ' globals=' + (globals.join(',') || 'none') + ' traces=' + traces + ' fremde-DOM-Änderungen=' + mutations;
         queueMicrotask(() => { own = false; });
       };`,
    ),
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${portA}`);
    if (url.pathname === '/welcome' && request.method === 'POST') {
      const form = await body(request);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return response.end(
        page(
          'Willkommen',
          `<p>Angemeldet als ${form.get('user')} (Passwort ${form.get('pass')?.length ?? 0} Zeichen)</p>`,
        ),
      );
    }
    if (url.pathname === '/report.txt') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="bericht 2026.txt"',
      });
      return response.end('Bericht: alles in Ordnung\n');
    }
    const render = pagesA[url.pathname];
    response.writeHead(render ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(render ? render() : 'not found');
  })
  .listen(portA, '127.0.0.1');

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${portB}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (url.pathname === '/welcome' && request.method === 'POST') {
      const form = await body(request);
      return response.end(
        page('Rahmen angemeldet', `<p>Im Rahmen angemeldet als ${form.get('user')}</p>`),
      );
    }
    response.end(page('Rahmen-Login', loginForm('/welcome'), showToggle));
  })
  .listen(portB, '127.0.0.1');

console.log(`test site on http://127.0.0.1:${portA} and http://127.0.0.1:${portB}`);
