// The gateway against a real, headed Chromium (design §9.2–9.4): every tool an agent has,
// through the real dispatcher and the real patchright session, on the test site (site.mjs).
// Helena is replaced by a stand-in that answers like the internal routes do (those are
// covered by the API's integration tests). Run by run.sh, not by `bun test`.
//
//   bun e2e/gateway-e2e.manual.ts <cdp-port> <site-port> <frame-port>
import {
  GatewayDispatcher,
  PatchrightGatewaySession,
  ProjectBrowserLocks,
  decodePng,
  type GatewayResponse,
  type PlanClient,
} from '../src/index.ts';

const [cdpPort, sitePort, framePort] = process.argv.slice(2, 5).map(Number) as [
  number,
  number,
  number,
];
const SITE = `http://127.0.0.1:${sitePort}`;
const FRAME = `http://127.0.0.1:${framePort}`;
const PASSWORD = 'e2e-Passwort-4711-geheim';
const FRAME_PASSWORD = 'rahmen-Passwort-0815';
const TOTP_CODE = '482913';

let failures = 0;
const outputs: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  if (!ok) failures++;
}

const planCalls: { route: string; body: unknown }[] = [];
const downloads: { fileName: string; bytes: Buffer }[] = [];
let settings = {
  domainBlocklist: [] as string[],
  domainAllowlist: [] as string[],
  humanInput: true,
  lockTimeoutSec: 120,
};

const planClient = {
  resolve: async () => ({
    agentId: 7,
    agentName: 'e2e-agent',
    teamId: 1,
    projectId: 1,
    projectKey: 'E2E',
    browserGatewayEnabled: true,
    settings,
  }),
  login: async (_key: string, _slug: string, _via: string, frameOrigin: string) => {
    planCalls.push({ route: 'login', body: { frameOrigin } });
    if (frameOrigin === SITE) {
      return {
        status: 'filled',
        login: {
          id: 1,
          label: 'Testseite',
          username: 'agent@example.com',
          password: PASSWORD,
          has2fa: true,
        },
      };
    }
    if (frameOrigin === FRAME) {
      return {
        status: 'filled',
        login: {
          id: 2,
          label: 'Rahmen',
          username: 'rahmen@example.com',
          password: FRAME_PASSWORD,
          has2fa: false,
        },
      };
    }
    return { status: 'none' };
  },
  loginCode: async (_key: string, credentialId: number, frameOrigin: string) => {
    planCalls.push({ route: 'login-code', body: { credentialId, frameOrigin } });
    return { code: TOTP_CODE, secondsRemaining: 20 };
  },
  audit: async (body: unknown) => {
    planCalls.push({ route: 'audit', body });
  },
  handover: async () => ({ approvalId: null }),
  handoverDone: async () => {},
  download: async () => ({ path: 'unused' }),
  policy: async () => ({}),
} as unknown as PlanClient;

const session = await PatchrightGatewaySession.connect(`http://127.0.0.1:${cdpPort}`, {
  humanInput: true,
  onDownload: async (fileName, bytes) => {
    downloads.push({ fileName, bytes });
    return `Projects/E2E/Inbox/${fileName}`;
  },
});
const gateway = new GatewayDispatcher({
  ownSlug: 'e2e',
  planClient,
  locks: new ProjectBrowserLocks(120_000),
  sessions: { get: async () => session },
});

async function call(
  tool: string,
  args: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const response: GatewayResponse = await gateway.handle({ tool, args, agentKey: 'k', ...extra });
  const text = response.ok ? response.content : response.error;
  outputs.push(JSON.stringify(response));
  return { ...response, text };
}

// The ref of the first line of a snapshot that matches, e.g. textbox "Benutzername".
function refOf(snapshot: string, pattern: RegExp): string {
  const line = snapshot.split('\n').find((candidate) => pattern.test(candidate));
  const match = line?.match(/\[ref=([a-z0-9]+)\]/);
  if (!match) throw new Error(`no ref for ${pattern} in:\n${snapshot.slice(0, 2000)}`);
  return match[1]!;
}

async function snapshot(): Promise<string> {
  const result = await call('browser_snapshot');
  if (!result.ok) throw new Error(result.text);
  return result.text;
}

try {
  check('acquire', (await call('browser_acquire')).ok);

  // Login with password and 2FA, the password never shown.
  check('navigate', (await call('browser_navigate', { url: `${SITE}/login` })).ok);
  let page = await snapshot();
  check(
    'snapshot shows the form with refs',
    /textbox "Benutzername" \[ref=(f\d+)?e\d+\]/.test(page),
    page.slice(0, 400),
  );
  const user = refOf(page, /textbox "Benutzername"/);
  const pass = refOf(page, /textbox "Passwort"/);
  const typed = await call('browser_type', { ref: pass, text: 'nicht erlaubt' });
  check(
    'typing into a password field is refused',
    !typed.ok && /browser_login/.test(typed.text),
    typed.text,
  );
  const wrongField = await call('browser_login', { usernameRef: pass, passwordRef: user });
  check('the password only goes into a password field', !wrongField.ok, wrongField.text);
  const login = await call('browser_login', { usernameRef: user, passwordRef: pass });
  check(
    'browser_login fills the login for the page origin',
    login.ok && login.text.includes('Testseite'),
    login.text,
  );
  check(
    'the login was chosen for the page origin',
    JSON.stringify(planCalls).includes(`"frameOrigin":"${SITE}"`),
  );
  await call('browser_click', { ref: refOf(await snapshot(), /button "Passwort anzeigen"/) });
  page = await snapshot();
  check(
    'a revealed password stays out of the snapshot',
    !page.includes(PASSWORD),
    page.slice(0, 600),
  );
  const shot = await call('browser_screenshot');
  check('a screenshot comes back as an image', shot.ok && 'image' in shot && !!shot.image);
  if (shot.ok && shot.image) {
    // The field (185 × 21 CSS pixels on this page) has to be one solid cover in the picture.
    const image = decodePng(Buffer.from(shot.image.data, 'base64'));
    let widest = 0;
    let rows = 0;
    for (let y = 0; y < image.height; y++) {
      let run = 0;
      let best = 0;
      for (let x = 0; x < image.width; x++) {
        const at = (y * image.width + x) * image.channels;
        const covered =
          image.pixels[at] === 17 && image.pixels[at + 1] === 17 && image.pixels[at + 2] === 17;
        run = covered ? run + 1 : 0;
        best = Math.max(best, run);
      }
      if (best >= 180) rows++;
      widest = Math.max(widest, best);
    }
    check(
      'the revealed password field is covered in the picture',
      widest >= 180 && rows >= 18,
      `widest ${widest}, rows ${rows}`,
    );
  }
  await call('browser_click', { ref: refOf(page, /button "Anmelden"/) });
  page = await snapshot();
  check('the login worked', page.includes('Angemeldet als agent@example.com'), page.slice(0, 300));
  check(
    `the page got the whole password (${PASSWORD.length} characters)`,
    page.includes(`Passwort ${PASSWORD.length} Zeichen`),
  );

  await call('browser_navigate', { url: `${SITE}/otp` });
  page = await snapshot();
  const code = await call('browser_login_code', {
    ref: refOf(page, /textbox "Code"/),
    credentialId: 1,
  });
  check('browser_login_code fills the code', code.ok, code.text);
  check(
    'the code was asked for the page origin',
    JSON.stringify(planCalls).includes(
      '"route":"login-code","body":{"credentialId":1,"frameOrigin":"' + SITE,
    ),
  );
  await call('browser_click', { ref: refOf(page, /button "Prüfen"/) });
  page = await snapshot();
  check('the code was accepted', page.includes('Code angenommen'), page.slice(0, 300));
  check('the code never comes back', !page.includes(TOTP_CODE));

  // A login form in an iframe of another site gets that site's login.
  await call('browser_navigate', { url: `${SITE}/frame` });
  page = await snapshot();
  const frameUser = refOf(page, /textbox "Benutzername"/);
  const framePass = refOf(page, /textbox "Passwort"/);
  check('refs reach into the iframe', /^f\d+e\d+$/.test(framePass), framePass);
  const frameLogin = await call('browser_login', {
    usernameRef: frameUser,
    passwordRef: framePass,
  });
  check(
    'the iframe login is chosen for the iframe origin',
    frameLogin.ok && frameLogin.text.includes('Rahmen'),
    frameLogin.text,
  );
  await call('browser_click', { ref: refOf(page, /button "Anmelden"/) });
  await new Promise((r) => setTimeout(r, 800));
  page = await snapshot();
  check(
    'the iframe login worked',
    page.includes('Im Rahmen angemeldet als rahmen@example.com'),
    page.slice(0, 500),
  );

  // Upload: the bytes, not a path.
  await call('browser_navigate', { url: `${SITE}/upload` });
  page = await snapshot();
  const upload = await call(
    'browser_upload',
    { ref: refOf(page, /button "Datei"/) },
    {
      upload: {
        name: 'angebot.pdf',
        mimeType: 'application/pdf',
        data: Buffer.from('%PDF-1.4 e2e').toString('base64'),
      },
    },
  );
  check('upload', upload.ok, upload.text);
  page = await snapshot();
  check(
    'the page got the file',
    page.includes('Gewählt: angebot.pdf (12 Bytes)'),
    page.slice(0, 300),
  );

  // Download: into the project's Inbox (through Helena).
  await call('browser_navigate', { url: `${SITE}/download` });
  page = await snapshot();
  await call('browser_click', { ref: refOf(page, /link "Bericht herunterladen"/) });
  for (let waited = 0; waited < 8000 && downloads.length === 0; waited += 200) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const listed = await call('browser_downloads');
  check(
    'download kept',
    downloads.length === 1 && downloads[0]!.bytes.toString() === 'Bericht: alles in Ordnung\n',
    listed.text,
  );
  check(
    'download named safely',
    downloads[0]?.fileName === 'bericht 2026.txt',
    downloads[0]?.fileName,
  );

  // A JavaScript dialog: the click returns as soon as it opens, the agent answers it.
  await call('browser_navigate', { url: `${SITE}/dialog` });
  page = await snapshot();
  const clicked = await call('browser_click', { ref: refOf(page, /button "Löschen"/) });
  check(
    'the click says a dialog opened',
    clicked.ok && clicked.text.includes('Wirklich löschen?'),
    clicked.text,
  );
  const status = await call('browser_status');
  check('the dialog is open', status.text.includes('Dialog open: yes'), status.text);
  const blockedByDialog = await call('browser_snapshot');
  check(
    'nothing else runs while it is open',
    !blockedByDialog.ok && blockedByDialog.text.includes('browser_dialog'),
    blockedByDialog.text,
  );
  const dialog = await call('browser_dialog', { action: 'accept' });
  check(
    'the dialog is answered',
    dialog.ok && dialog.text.includes('Wirklich löschen?'),
    dialog.text,
  );
  await new Promise((r) => setTimeout(r, 300));
  page = await snapshot();
  check('the page saw the answer', page.includes('gelöscht'), page.slice(0, 300));

  // Tabs.
  const opened = await call('browser_tabs', { action: 'open', url: `${SITE}/` });
  check('open a tab', opened.ok, opened.text);
  const tabs = await call('browser_tabs', { action: 'list' });
  check("the new tab is the agent's", /\(active, yours\)/.test(tabs.text), tabs.text);
  const tabId = tabs.text.match(/\[(t\d+)\][^\n]*\(active, yours\)/)?.[1];
  check('close it', (await call('browser_tabs', { action: 'close', tabId })).ok);

  // Console and network, token values hidden.
  await call('browser_navigate', { url: `${SITE}/token?token=sehr-geheim-123&page=2` });
  const network = await call('browser_network', { limit: 5 });
  check(
    'network lists the request, token hidden',
    network.text.includes('token=%E2%80%A6') &&
      network.text.includes('page=2') &&
      !network.text.includes('sehr-geheim-123'),
    network.text,
  );
  await call('browser_navigate', { url: `${SITE}/missing-page` });
  const consoleLog = await call('browser_console', { limit: 10 });
  check(
    'the browser log names the failed request',
    consoleLog.text.includes('404'),
    consoleLog.text,
  );

  // Domain rules: a blocked host is refused, also through a link.
  settings = { ...settings, domainBlocklist: ['localhost'] };
  const blocked = await call('browser_navigate', { url: `http://localhost:${sitePort}/` });
  check('a blocked host is refused', !blocked.ok, blocked.text);
  await call('browser_navigate', { url: `${SITE}/blocked-link` });
  page = await snapshot();
  await call('browser_click', { ref: refOf(page, /link "Zur gesperrten Seite"/) });
  await new Promise((r) => setTimeout(r, 800));
  const after = await call('browser_status');
  check(
    'a link to a blocked host does not load it',
    !after.text.includes(`localhost:${sitePort}/ `) && !after.text.includes('"Start"'),
    after.text,
  );
  settings = { ...settings, domainBlocklist: [] };

  // Bot signals: nothing the page could see.
  await call('browser_navigate', { url: `${SITE}/leaks` });
  page = await snapshot();
  await call('browser_screenshot');
  await call('browser_click', { ref: refOf(page, /button "Bericht"/) });
  page = await snapshot();
  check(
    'no automation signal and no foreign DOM change',
    page.includes('webdriver=false globals=none traces=false fremde-DOM-Änderungen=0'),
    page.slice(0, 400),
  );

  check('release', (await call('browser_release')).ok);
} catch (error) {
  check(
    'no unexpected error',
    false,
    error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
  );
}

// Design §9.3: the password appears in no answer at all.
const everything = outputs.join('\n');
check(
  'no password in any answer',
  !everything.includes(PASSWORD) && !everything.includes(FRAME_PASSWORD),
);
check('no 2FA code in any answer', !everything.includes(TOTP_CODE));

console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
