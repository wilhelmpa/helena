// A local site for browser_task's eval and end-to-end check: the page kinds the loop has to
// handle (a form, a search, a dropdown, a checkbox already ticked, a cookie banner over the
// content, an iframe, shadow DOM, a confirm dialog, a login wall, content that loads late).
// Every page says in its own text what happened, so a task's result can be checked from what a
// person would see.
//
//   node eval/fixture-site.mjs <port>
import http from 'node:http';

const port = Number(process.argv[2] || 18650);
const page = (title, body, script = '') =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>` +
  '<style>body{font:15px system-ui;margin:24px;max-width:760px}label{display:block;margin:8px 0}' +
  '#banner{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}' +
  '#banner div{background:#fff;padding:24px}</style></head>' +
  `<body><h1>${title}</h1>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

function readBody(request) {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(new URLSearchParams(data)));
  });
}

const escape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const PRODUCTS = [
  'Wanderschuh Alpin',
  'Regenjacke Nordwind',
  'Rucksack Gipfel 30',
  'Stirnlampe Hell',
  'Trinkflasche 1 l',
];

const routes = {
  'GET /': () =>
    page(
      'Beispiel-Shop',
      '<nav><a href="/kontakt">Kontakt</a> · <a href="/suche">Suche</a> · <a href="/filter">Sortiment</a> · ' +
        '<a href="/agb">Bestellung</a> · <a href="/news">Neuigkeiten</a> · <a href="/konto">Mein Konto</a></nav>' +
        '<p>Willkommen im Beispiel-Shop.</p>',
    ),
  'GET /kontakt': () =>
    page(
      'Kontakt',
      '<form method="post" action="/kontakt">' +
        '<label>Name <input name="name"></label>' +
        '<label>E-Mail <input name="email" type="email"></label>' +
        '<label>Thema <select name="topic"><option>Bitte wählen</option><option>Frage</option><option>Angebot</option></select></label>' +
        '<label>Nachricht <textarea name="message"></textarea></label>' +
        '<button type="submit">Senden</button></form>',
    ),
  'POST /kontakt': async (request) => {
    const form = await readBody(request);
    if (!form.get('name') || !form.get('email'))
      return page(
        'Fehler',
        '<p>Fehler: Bitte Name und E-Mail ausfüllen.</p><a href="/kontakt">Zurück</a>',
      );
    return page(
      'Danke',
      `<p>Danke, ${escape(form.get('name'))}! Ihre Nachricht wurde gesendet.</p><p>Thema: ${escape(form.get('topic'))}</p><a href="/">Start</a>`,
    );
  },
  'GET /suche': (url) => {
    const q = (url.searchParams.get('q') || '').trim();
    const hits = q ? PRODUCTS.filter((p) => p.toLowerCase().includes(q.toLowerCase())) : [];
    return page(
      q ? `Suche: ${escape(q)}` : 'Suche',
      '<form action="/suche"><label>Suchbegriff <input name="q" type="search"></label><button>Suchen</button></form>' +
        (q
          ? `<p>${hits.length} Treffer für „${escape(q)}“</p><ul>${hits.map((p) => `<li><a href="/produkt?name=${encodeURIComponent(p)}">${p}</a></li>`).join('')}</ul>`
          : ''),
    );
  },
  'GET /produkt': (url) =>
    page(
      escape(url.searchParams.get('name') || 'Produkt'),
      '<p>Produktseite. Preis: 49 €.</p><a href="/suche">Zur Suche</a>',
    ),
  'GET /filter': (url) => {
    const sort = url.searchParams.get('sort') || 'relevanz';
    const list = [...PRODUCTS];
    if (sort === 'name') list.sort();
    return page(
      'Sortiment',
      '<form action="/filter"><label>Sortieren nach <select name="sort" onchange="this.form.submit()">' +
        `<option value="relevanz"${sort === 'relevanz' ? ' selected' : ''}>Relevanz</option>` +
        `<option value="name"${sort === 'name' ? ' selected' : ''}>Name (A–Z)</option>` +
        `<option value="preis"${sort === 'preis' ? ' selected' : ''}>Preis</option></select></label></form>` +
        `<p>Sortiert nach: ${escape(sort)}</p><ol>${list.map((p) => `<li>${p}</li>`).join('')}</ol>`,
    );
  },
  'GET /agb': () =>
    page(
      'Bestellung',
      '<div id="banner"><div><p>Wir verwenden Cookies.</p><button id="ok">Alle akzeptieren</button></div></div>' +
        '<form method="post" action="/agb"><label><input type="checkbox" name="news" checked> Newsletter abonnieren</label>' +
        '<label><input type="checkbox" name="agb"> Ich akzeptiere die AGB</label>' +
        '<button type="submit">Weiter zur Kasse</button></form>',
      "document.getElementById('ok').onclick = () => document.getElementById('banner').remove();",
    ),
  'POST /agb': async (request) => {
    const form = await readBody(request);
    return form.get('agb')
      ? page(
          'Kasse',
          `<p>AGB akzeptiert. Newsletter: ${form.get('news') ? 'ja' : 'nein'}.</p><button id="buy" onclick="document.body.insertAdjacentHTML('beforeend','<p>Bestellung aufgegeben</p>')">Jetzt kaufen</button>`,
        )
      : page('Fehler', '<p>Fehler: Bitte die AGB akzeptieren.</p><a href="/agb">Zurück</a>');
  },
  'GET /news': () =>
    page(
      'Neuigkeiten',
      '<button id="more">Weitere laden</button><div id="list"><p>Neuigkeit 1</p></div>',
      "document.getElementById('more').onclick = () => { const b = document.getElementById('more'); b.disabled = true; b.textContent = 'Lädt …';" +
        " setTimeout(() => { document.getElementById('list').insertAdjacentHTML('beforeend', '<p>Neuigkeit 2</p><p>Neuigkeit 3</p><p>Alle Neuigkeiten geladen</p>'); b.remove(); }, 1200); };",
    ),
  'GET /konto': () =>
    page(
      'Anmelden',
      '<form method="post" action="/konto"><label>E-Mail <input name="user" autocomplete="username"></label>' +
        '<label>Passwort <input name="pass" type="password" autocomplete="current-password"></label><button type="submit">Anmelden</button></form>',
    ),
  'GET /frame': () =>
    page(
      'Rahmen',
      '<iframe src="/frame-inner" width="500" height="200"></iframe><p id="r"></p>',
      "window.addEventListener('message', e => { if (e.origin === location.origin && e.data === 'confirmed') document.getElementById('r').textContent = 'Im Rahmen bestätigt'; });",
    ),
  'GET /frame-inner': () =>
    page(
      'Innen',
      '<button onclick="parent.postMessage(\'confirmed\', location.origin)">Bestätigen</button>',
    ),
  'GET /shadow': () =>
    page(
      'Schatten',
      '<div id="host"></div><p id="r">Noch nicht gespeichert</p>',
      "const root = document.getElementById('host').attachShadow({mode:'open'}); root.innerHTML = '<button>Speichern</button>';" +
        " root.querySelector('button').onclick = () => { document.getElementById('r').textContent = 'Gespeichert'; };",
    ),
  'GET /loeschen': () =>
    page(
      'Einträge',
      '<ul><li>Eintrag A <button onclick="if(confirm(\'Eintrag A wirklich löschen?\')) this.parentElement.remove()">Löschen</button></li></ul>',
    ),
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page('Nicht gefunden', '<p>Fehler 404: Seite nicht gefunden.</p>'));
      return;
    }
    const html = await handler(request.method === 'GET' ? url : request, url);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  })
  .listen(port, '127.0.0.1', () => console.log(`fixture site on http://127.0.0.1:${port}`));
