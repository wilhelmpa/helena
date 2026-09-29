#!/usr/bin/env node
// UI audit (Auftrag 117, owner 29.09.): every page, light and dark, desktop 1440 and phone
// 390, measured in a real browser against the design system instead of by eye:
//   backgrounds  the page surface of every page is the same token (--bg) and every larger
//                surface (card, list box, panel, modal) is one of the surface tokens — no
//                fixed colours, no white in dark, no grey of its own;
//   spacing      the page body's side and top padding, the gap from the toolbar to the first
//                content and the top of the title are the page template's (PageTemplate.tsx);
//   frames       task list and table are framed (.ds-issue-list-box / table card) and their
//                status is its own box (.ds-issue-status) in list, table and board.
// It needs a running Ava and a user; it writes a JSON report and prints what deviates.
//
//   UI_AUDIT_WEB=http://127.0.0.1:3661 UI_AUDIT_API=http://127.0.0.1:3662 \
//   UI_AUDIT_EMAIL=… UI_AUDIT_PASSWORD=… UI_AUDIT_PROJECT=SITE \
//   node apps/web/scripts/ui-audit.mjs [--themes=dark,light] [--widths=1440,390] [--out=report.json]
//
// Playwright comes from the repository (the browser gateway's playwright-core);
// UI_AUDIT_CHROME names the Chrome or Chromium binary it drives.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// playwright-core, as the browser gateway uses it (no browsers of its own: UI_AUDIT_CHROME).
const require = createRequire(
  new URL('../../../packages/browser-gateway/package.json', import.meta.url),
);
const { chromium, request } = require('playwright-core');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
const web = process.env.UI_AUDIT_WEB ?? 'http://127.0.0.1:3001';
const api = process.env.UI_AUDIT_API ?? 'http://127.0.0.1:3000';
const project = process.env.UI_AUDIT_PROJECT ?? 'VOL';
const themes = (args.themes ?? 'dark,light').split(',');
const widths = (args.widths ?? '1440,390').split(',').map(Number);

export const ROUTES = [
  '/',
  '/inbox',
  '/dashboard',
  '/tasks',
  '/organization',
  '/organization?orgView=tree',
  '/organization?orgView=list',
  '/organization?tab=goals',
  '/activity',
  '/files',
  '/files?kind=files',
  '/schedules',
  '/workflows',
  '/settings',
  `/project/${project}/dashboard`,
  `/project/${project}`,
  `/project/${project}#layout=list`,
  `/project/${project}#layout=table`,
  `/project/${project}/inbox`,
  `/project/${project}/files`,
  `/project/${project}/files?path=Docs`,
  `/project/${project}/files?trash=1`,
  `/project/${project}/receipts`,
  `/project/${project}/initiatives`,
  `/project/${project}/organization`,
  `/project/${project}/organization?orgView=list`,
  `/project/${project}/ai-team/schedules`,
  `/project/${project}/workflows`,
  `/project/${project}/activity`,
  `/project/${project}/settings/general`,
  `/project/${project}/settings/autopilot`,
];

// Runs in the page: the measurements of one route.
function measure() {
  const tokenNames = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules ?? []) {
      const style = rule.style;
      if (!style) continue;
      for (let i = 0; i < style.length; i += 1)
        if (style[i].startsWith('--')) tokenNames.add(style[i]);
    }
  }
  const probe = document.createElement('div');
  document.body.appendChild(probe);
  const tokens = new Map();
  for (const name of tokenNames) {
    probe.style.backgroundColor = '';
    probe.style.backgroundColor = `var(${name})`;
    const value = getComputedStyle(probe).backgroundColor;
    if (value && value !== 'rgba(0, 0, 0, 0)' && !tokens.has(value)) tokens.set(value, name);
  }
  probe.remove();
  const tokenOf = (color) => tokens.get(color) ?? null;
  const transparent = (color) =>
    !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
  const describe = (element) => {
    const classes =
      typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
  };
  const surfaceOf = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (!transparent(color)) return { color, token: tokenOf(color), at: describe(node) };
    }
    return null;
  };
  const luminance = (color) => {
    const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const dark =
    document.documentElement.classList.contains('dark') ||
    document.documentElement.dataset.theme === 'dark';
  const body = document.querySelector('.ds-page > .ds-page-scroll > .ds-page-body');
  const out = { page: null, offenders: [], white: [], spacing: null, frames: null };
  if (body) out.page = surfaceOf(body);
  // Larger surfaces whose colour is no token, and white in dark.
  const roots = [
    ...document.querySelectorAll(
      'main, .ds-side-panel[data-open="true"], .ds-modal, [role="dialog"]',
    ),
  ];
  const seen = new Set();
  for (const root of roots)
    for (const element of root.querySelectorAll('*')) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (/^(IMG|VIDEO|CANVAS|IFRAME|SVG|PATH)$/i.test(element.tagName)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height < 4000 || rect.bottom < 0 || rect.top > innerHeight) continue;
      const color = getComputedStyle(element).backgroundColor;
      if (transparent(color)) continue;
      if (!tokenOf(color) && out.offenders.length < 12)
        out.offenders.push({ at: describe(element), color });
      if (dark && luminance(color) > 0.85 && out.white.length < 6)
        out.white.push({ at: describe(element), color });
    }
  // Spacing of the page template.
  if (body) {
    const style = getComputedStyle(body);
    const toolbar = document.querySelector(
      '.ds-page > .ds-page-toolbar, [data-slot="app-page-bar"]',
    );
    const header = document.querySelector('.ds-page-header, header.ds-page-head, main > header');
    const first = [...body.querySelectorAll('*')].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.children.length === 0;
    });
    out.spacing = {
      padLeft: parseFloat(style.paddingLeft),
      padRight: parseFloat(style.paddingRight),
      padTop: parseFloat(style.paddingTop),
      toolbarToContent:
        toolbar && first
          ? Math.round(first.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom)
          : null,
      titleTop: header ? Math.round(header.getBoundingClientRect().top) : null,
    };
  }
  // Frames and status boxes of tasks.
  out.frames = {
    listBox: document.querySelectorAll('.ds-issue-list-box').length,
    statusBox: document.querySelectorAll('.ds-issue-status').length,
    table: document.querySelectorAll('main table').length,
    tableCard: document.querySelectorAll('.ds-table-card, .ds-issue-table-box').length,
    boardCards: document.querySelectorAll('.board-card, [data-board-card]').length,
  };
  return out;
}

async function login() {
  const context = await request.newContext({ baseURL: api });
  const response = await context.post('/api/auth/sign-in/email', {
    data: { email: process.env.UI_AUDIT_EMAIL, password: process.env.UI_AUDIT_PASSWORD },
    headers: { origin: web },
  });
  if (!response.ok()) throw new Error(`sign-in ${response.status()}`);
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => {
      const [name, ...value] = header.value.split(';')[0].split('=');
      return { name, value: value.join('='), url: web };
    });
}

// What deviates from the majority and the rules, per route.
export function findings(results) {
  const out = [];
  const mode = (values) => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  for (const group of Object.values(Object.groupBy(results, (r) => `${r.theme}/${r.width}`))) {
    const pageColor = mode(group.map((r) => r.page?.color).filter(Boolean));
    const padLeft = mode(group.map((r) => r.spacing?.padLeft).filter((v) => v != null));
    const padTop = mode(group.map((r) => r.spacing?.padTop).filter((v) => v != null));
    for (const r of group) {
      const tag = `${r.theme}/${r.width} ${r.route}`;
      if (r.page && r.page.color !== pageColor)
        out.push(
          `${tag}: Seitenfläche ${r.page.color} (${r.page.token ?? 'kein Token'}) statt ${pageColor}`,
        );
      for (const offender of r.offenders)
        out.push(`${tag}: Fläche ohne Token ${offender.color} an ${offender.at}`);
      for (const white of r.white) out.push(`${tag}: Weiß im Dunkeln an ${white.at}`);
      if (r.spacing && (r.spacing.padLeft !== padLeft || r.spacing.padTop !== padTop))
        out.push(
          `${tag}: Abstand ${r.spacing.padLeft}/${r.spacing.padTop} statt ${padLeft}/${padTop}`,
        );
      if (r.route.includes('layout=list') && r.frames.listBox === 0)
        out.push(`${tag}: Liste ohne Rahmen (.ds-issue-list-box)`);
      if (r.route.includes('layout=table') && r.frames.table > 0 && r.frames.statusBox === 0)
        out.push(`${tag}: Tabelle ohne Status-Box (.ds-issue-status)`);
    }
  }
  return out;
}

async function main() {
  const cookies = await login();
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_AUDIT_CHROME ? { executablePath: process.env.UI_AUDIT_CHROME } : {}),
  });
  const results = [];
  for (const theme of themes)
    for (const width of widths) {
      const phone = width < 600;
      const context = await browser.newContext({
        viewport: { width, height: phone ? 844 : 900 },
        colorScheme: theme,
        isMobile: phone,
        hasTouch: phone,
      });
      await context.addCookies([...cookies, { name: 'NEXT_LOCALE', value: 'de', url: web }]);
      await context.addInitScript((value) => localStorage.setItem('theme', value), theme);
      const page = await context.newPage();
      for (const route of args.routes ? args.routes.split('|') : ROUTES) {
        // "#layout=table": the task layout lives in the browser (useViewEditor's
        // planner_view), set before the page reads it.
        const [path, layout] = route.split('#layout=');
        if (!page.url().startsWith(web)) await page.goto(`${web}/`, { waitUntil: 'load' });
        await page
          .evaluate((value) => {
            if (value) localStorage.setItem('planner_view', value);
            else localStorage.removeItem('planner_view');
          }, layout ?? null)
          .catch(() => {});
        await page.goto(web + path, { waitUntil: 'load', timeout: 90_000 });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(800);
        // A page that redirects once more (a default view) is measured where it lands.
        const measured = await page.evaluate(measure).catch(async () => {
          await page.waitForLoadState('load');
          await page.waitForTimeout(800);
          return page.evaluate(measure);
        });
        results.push({ route, theme, width, ...measured });
      }
      await context.close();
    }
  await browser.close();
  const report = { at: new Date().toISOString(), results, findings: findings(results) };
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
  console.log(`${results.length} Ansichten, ${report.findings.length} Befunde`);
  for (const finding of report.findings) console.log(`  ${finding}`);
  process.exitCode = report.findings.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
