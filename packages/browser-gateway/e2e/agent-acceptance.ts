// Acceptance §5.6 of docs/volition-design-browser-perfekt.md on the live instance: each named
// agent (Hermes, Claude Code, Codex — whatever runtime it has) does the same scenario in ITS
// project's browser, through the Projekt-Browser tools, started the way work reaches an agent
// (a mention on a task). Everything is checked from the outside:
//   - the test site (acceptance-site.mjs) records each step server-side: form values, login
//     with the right password, a valid TOTP code, the uploaded content, the download, the
//     second tab, the confirmed dialog;
//   - the browser router's overview says in which project browser the site was open — it
//     must be the agent's own project and no other;
//   - Helena's audit of that project names the agent; the run's answer carries the code only
//     the second tab shows, and neither the password nor the TOTP secret anywhere.
// A web login is created in Zugänge for the run and granted to the agent only, and removed
// again afterwards; the task is archived.
//
//   OWNER_API_KEY=<a key of the owner> bun packages/browser-gateway/e2e/agent-acceptance.ts \
//     --project VOL --agent coder-vol [--agent codex-vol …] [--api http://127.0.0.1:3000] \
//     [--router http://127.0.0.1:6082] [--port 18590] [--timeout 1500]
//
// Run it on Kingston (the site listens on 127.0.0.1, where the project browsers are).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const agents = args.flatMap((value, index) => (args[index - 1] === '--agent' ? [value] : []));
const projectKey = option('project');
const API = option('api', 'http://127.0.0.1:3000')!;
const ROUTER = option('router', 'http://127.0.0.1:6082')!;
const PORT = Number(option('port', '18590'));
const TIMEOUT_MS = Number(option('timeout', '1500')) * 1000;
const KEY = process.env.OWNER_API_KEY;
if (!projectKey || agents.length === 0 || !KEY) {
  console.error(
    'usage: OWNER_API_KEY=… agent-acceptance.ts --project KEY --agent USERNAME [--agent …]',
  );
  process.exit(64);
}

const SITE = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(24).toString('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const slugOf = (key: string) => (key === 'VERV' ? 'verve' : key.toLowerCase());

async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-api-key': KEY!, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${route}: ${response.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function admin<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${SITE}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await response.json()) as T;
}

function base32Secret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return [...crypto.randomBytes(20)].map((byte) => alphabet[byte % 32]).join('');
}

function scenario(token: string, username: string): string {
  const url = (step: string) => `${SITE}/a/${token}${step}`;
  return [
    `@${username} Abnahmetest Projekt-Browser. Nutze dafür ausschließlich die Werkzeuge des MCP-Servers „projekt-browser“ (browser_…), keinen anderen Browser.`,
    '1. Arbeite direkt los: die erste Aktion übernimmt die Steuerung des Browsers.',
    `2. Formular: öffne ${url('/form')}, trage Name „Abnahme ${username}“ und E-Mail „abnahme@example.com“ ein, wähle Farbe „grün“, hake „AGB akzeptiert“ an und sende ab.`,
    `3. Login: öffne ${url('/login')} und melde dich mit browser_login an (das Passwort nie selbst tippen oder erfragen). Auf der nächsten Seite trägst du den Code mit browser_login_code ein und bestätigst.`,
    `4. Upload: lege in deinem Arbeitsverzeichnis die Datei abnahme-${token.slice(0, 8)}.txt mit dem Inhalt „${token}“ an, öffne ${url('/upload')}, lade sie mit browser_file_upload hoch und klicke „Hochladen“.`,
    `5. Download: öffne ${url('/download')}, klicke „Bericht herunterladen“ und prüfe mit browser_downloads, wo die Datei abgelegt wurde.`,
    `6. Zweiter Tab: öffne ${url('/tab2')} mit browser_tabs (action new), lies den Code auf der Seite und schließe den Tab wieder.`,
    `7. Dialog: öffne ${url('/dialog')}, klicke „Löschen“ und bestätige den Dialog mit browser_handle_dialog (accept).`,
    '8. browser_release.',
    'Antworte zum Schluss mit „FERTIG“, dem Code aus Schritt 6 und der Ablage aus Schritt 5.',
  ].join('\n');
}

interface Project {
  id: number;
  key: string;
  teamId: number;
}
interface Agent {
  id: number;
  userId: string;
  username: string;
  name?: string;
  kind?: string;
}
interface Run {
  id: number;
  status: string;
  issueId: number | null;
  output: string | null;
  lastError: string | null;
}

const site = spawn(process.execPath.endsWith('bun') ? 'node' : process.execPath, [
  path.join(import.meta.dir, 'acceptance-site.mjs'),
  String(PORT),
  ADMIN,
]);
site.stderr.on('data', (chunk) => process.stderr.write(chunk));
process.on('exit', () => site.kill());
for (let attempt = 0; ; attempt++) {
  const ready = await fetch(`${SITE}/admin/events?token=none`, {
    headers: { authorization: `Bearer ${ADMIN}` },
  })
    .then((response) => response.ok)
    .catch(() => false);
  if (ready) break;
  if (attempt > 30) throw new Error(`The acceptance site did not start on ${SITE} (port in use?)`);
  await sleep(200);
}

const projects = await api<Project[]>('/projects');
const project = projects.find((row) => row.key === projectKey);
if (!project) throw new Error(`Project ${projectKey} not found`);
const slug = slugOf(project.key);
// A task starts in the project's first open column.
const detail = await api<{ columns: { id: number; stateType: string; position: number }[] }>(
  `/projects/${project.key}`,
);
const column = [...detail.columns]
  .sort((a, b) => a.position - b.position)
  .find((row) => row.stateType === 'unstarted' || row.stateType === 'backlog');
if (!column) throw new Error(`Project ${project.key} has no open column`);
const teamAgents = await api<Agent[]>(`/teams/${project.teamId}/ai-agents`);

let failed = 0;
const report: string[] = [];
const check = (agent: string, name: string, ok: boolean, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'} [${agent}] ${name}${detail ? ` — ${detail}` : ''}`;
  report.push(line);
  console.log(line);
  if (!ok) failed++;
};

for (const username of agents) {
  const agent = teamAgents.find((row) => row.username === username);
  if (!agent) {
    check(username, 'agent exists in the project team', false);
    continue;
  }
  const servers = await api<{ name: string }[] | { items?: { name: string }[] }>(
    `/teams/${project.teamId}/ai-agents/${agent.id}/mcp-servers`,
  ).catch(() => null);
  const serverNames = (Array.isArray(servers) ? servers : (servers?.items ?? [])).map(
    (row) => row.name,
  );
  check(
    username,
    'Projekt-Browser is on for the agent',
    serverNames.includes('projekt-browser'),
    serverNames.join(', '),
  );

  // A test login left behind by an interrupted earlier run would make browser_login ask
  // which of two logins to use: removed first.
  const existing = await api<
    { id: number; label: string | null }[] | { items?: { id: number; label: string | null }[] }
  >(`/teams/${project.teamId}/credentials`).catch(() => null);
  for (const row of Array.isArray(existing) ? existing : (existing?.items ?? [])) {
    if (row.label?.startsWith(`Abnahme ${username} `)) {
      await api(`/teams/${project.teamId}/credentials/${row.id}`, { method: 'DELETE' }).catch(
        () => {},
      );
    }
  }

  const token = crypto.randomBytes(12).toString('hex');
  const password = `Abn-${crypto.randomBytes(9).toString('base64url')}`;
  const totpSecret = base32Secret();
  const login = { username: `abnahme-${username}@example.com`, password, totpSecret };
  await admin('/admin/expect', { token, ...login });
  const credential = await api<{ id: number }>(`/teams/${project.teamId}/credentials`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'web_login',
      label: `Abnahme ${username} ${token.slice(0, 6)}`,
      loginUrl: `${SITE}/a/${token}/login`,
      allowedDomains: [],
      ...login,
    }),
  });
  await api(`/teams/${project.teamId}/credentials/${credential.id}/grants`, {
    method: 'PUT',
    body: JSON.stringify({ agentIds: [agent.id] }),
  });
  let issueId: number | null = null;
  try {
    const issue = await api<{ id: number; sequenceNumber: number }>(
      `/projects/${project.key}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({
          columnId: column.id,
          title: `Abnahme Projekt-Browser (${username})`,
          description: 'Automatischer Abnahmetest des Projekt-Browsers (agent-acceptance.ts).',
        }),
      },
    );
    issueId = issue.id;
    await api(`/issues/${issue.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: scenario(token, username) }),
    });
    console.log(
      `[${username}] task ${project.key}-${issue.sequenceNumber} asks for the scenario (run ${token}); waiting …`,
    );

    // Which project browser has the site open, while the agent works.
    const seenIn = new Set<string>();
    let run: Run | undefined;
    const started = Date.now();
    while (Date.now() - started < TIMEOUT_MS) {
      const overview = await fetch(`${ROUTER}/api/overview`)
        .then(
          (response) =>
            response.json() as Promise<{ browsers: { slug: string; url: string | null }[] }>,
        )
        .catch(() => ({ browsers: [] }));
      for (const browser of overview.browsers) {
        if (browser.url?.includes(`/a/${token}`)) seenIn.add(browser.slug);
      }
      const runs = await api<{ items: Run[] }>(
        `/teams/${project.teamId}/ai-agents/${agent.id}/runs?limit=20`,
      ).catch(() => ({ items: [] as Run[] }));
      run = runs.items.find((candidate) => candidate.issueId === issue.id);
      if (run && !['pending', 'running', 'queued'].includes(run.status)) break;
      await sleep(3000);
    }

    const events = await admin<
      { name: string; ok?: boolean; values?: Record<string, string>; contains?: boolean }[]
    >(`/admin/events?token=${token}`);
    const event = (name: string) => events.find((row) => row.name === name);
    check(
      username,
      'the run finished',
      !!run && run.status === 'success',
      run ? `${run.status} ${run.lastError ?? ''}` : 'no run',
    );
    check(
      username,
      `the site was open in this project's browser (${slug}) and no other`,
      seenIn.has(slug) && seenIn.size === 1,
      [...seenIn].join(', ') || 'never seen',
    );
    const form = event('form')?.values ?? {};
    check(
      username,
      'form: name, e-mail, select and checkbox arrived',
      form.name === `Abnahme ${username}` &&
        form.email === 'abnahme@example.com' &&
        form.color === 'grün' &&
        form.agb === 'on',
      JSON.stringify(form),
    );
    check(username, 'login with the password from Zugänge', event('login')?.ok === true);
    check(
      username,
      'TOTP code from Helena accepted',
      events.some((row) => row.name === 'otp' && row.ok === true),
    );
    check(username, 'upload of a file from the workspace', event('upload')?.contains === true);
    check(username, 'download', !!event('download'));
    check(username, 'second tab', !!event('tab2'));
    check(username, 'dialog confirmed', !!event('dialog-accepted'));
    const answer = `${run?.output ?? ''}\n${run?.lastError ?? ''}`;
    check(
      username,
      "the answer names the second tab's code",
      answer.includes(`T2-${token.slice(-6).toUpperCase()}`),
    );
    check(
      username,
      'no password and no TOTP secret in the answer',
      !answer.includes(password) && !answer.includes(totpSecret),
    );
    const audit = await api<{
      items: { agentId: number | null; tool: string; target: string | null }[];
    }>(`/projects/${project.key}/browser-gateway/events?limit=200`);
    const mine = audit.items.filter((row) => row.agentId === agent.id);
    check(
      username,
      "the project's audit names the agent's browser actions",
      mine.some((row) => row.tool === 'browser_navigate' && row.target?.includes(token)),
      `${mine.length} actions`,
    );
    check(
      username,
      'the download was filed into the project Inbox',
      mine.some((row) => row.tool === 'browser_download') ||
        audit.items.some(
          (row) => row.tool === 'browser_download' && row.target?.includes(token.slice(0, 8)),
        ),
    );
  } catch (error) {
    check(
      username,
      'no unexpected error',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await api(`/teams/${project.teamId}/credentials/${credential.id}`, { method: 'DELETE' }).catch(
      (error) => console.error(`could not remove the test login: ${error}`),
    );
    if (issueId !== null)
      await api(`/issues/${issueId}/archive`, { method: 'POST' }).catch(() => {});
  }
}

site.kill();
console.log(failed === 0 ? '\nACCEPTANCE PASSED' : `\nACCEPTANCE: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
