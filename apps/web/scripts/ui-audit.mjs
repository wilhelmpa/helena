#!/usr/bin/env node
// UI audit (Auftrag 117, owner 29.09.): every page, light and dark, desktop 1440 and phone
// 390, measured in a real browser against the design system instead of by eye:
//   backgrounds  the page surface of every page is the same token (--bg) and every larger
//                surface (card, list box, panel, modal) is one of the surface tokens — no
//                fixed colours, no white in dark, no grey of its own;
//   spacing      the page body's side and top padding, the gap from the toolbar to the first
//                content and the top of the title are the page template's (PageTemplate.tsx);
//   frames       task list and table are framed (.ds-issue-list-box / table card) and their
//                status is its own box (.ds-issue-status) in list, table and board;
//   edges        (O92, O104) the breadcrumb, the toolbar row of a phone and the first content
//                of every page stand on one left edge, the header is 56px and the content starts
//                the padding below it;
//   overlays     (O102, O103) the chat panel, a task, an agent, a file and the settings modal are
//                opened and compared: head height, control order and size, distance to the
//                window, inner distance, Esc; a pinned overlay takes its room from the page.
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
import { edgeFindings, overlayFindings } from './ui-audit-rules.mjs';

// playwright-core, as the browser gateway uses it (no browsers of its own: UI_AUDIT_CHROME).
const require = createRequire(
  new URL('../../../packages/browser-gateway/package.json', import.meta.url),
);
const { chromium, request } = require('playwright-core');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.length > 0 ? value.join('=') : 'true'];
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
      // White in dark: a light surface that is no token (the primary button's lavender is).
      if (dark && !tokenOf(color) && luminance(color) > 0.85 && out.white.length < 6)
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
      variant: document.querySelector('.ds-page')?.getAttribute('data-page') ?? null,
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

// Runs in the page: where the header, the toolbar row and the first content start (O92, O104).
function measureEdges() {
  const main = document.querySelector('.ds-main');
  const header = document.querySelector('.ds-page-header');
  if (!main || !header) return { none: true };
  const round = (value) => Math.round(value * 10) / 10;
  const mainBox = main.getBoundingClientRect();
  const headerBox = header.getBoundingClientRect();
  const visible = (element) => element && getComputedStyle(element).display !== 'none';
  const menu = header.querySelector('.ds-page-menu-button');
  const first = visible(menu)
    ? menu.querySelector('svg')
    : header.querySelector('.ds-page-crumb, .ds-page-title');
  const bar = header.querySelector('.ds-page-bar');
  const phone = innerWidth < 900;
  const barFirst =
    phone && visible(bar)
      ? [...bar.querySelectorAll('button, a, input, nav, [role=tablist]')].find(
          (element) => element.getBoundingClientRect().width > 0,
        )
      : null;
  const scroll =
    document.querySelector('.ds-page-scroll') ?? document.querySelector('.ds-page-content');
  const top = headerBox.bottom;
  const items = [];
  for (const element of (scroll ?? main).querySelectorAll('*')) {
    if (element.closest('.ds-side-panel, [role=dialog], .ds-dock, .ds-empty, .react-flow'))
      continue;
    const box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4 || box.top < top - 1 || box.top > top + 120) continue;
    if (box.left < mainBox.left - 1 || box.width > mainBox.width - 8) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      continue;
    if (style.position === 'fixed') continue;
    const boxed =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0 ||
      style.boxShadow !== 'none';
    const text = [...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!boxed && !text && element.tagName !== 'svg' && element.tagName !== 'IMG') continue;
    items.push({ left: box.left, top: box.top });
  }
  const content = items.length ? Math.min(...items.map((item) => item.left)) : null;
  const contentTop = items.length ? Math.min(...items.map((item) => item.top)) : null;
  const rootStyle = getComputedStyle(document.documentElement);
  const px = (name, fallback) => parseFloat(rootStyle.getPropertyValue(name)) || fallback;
  return {
    variant: document.querySelector('.ds-page')?.getAttribute('data-page') ?? null,
    phone,
    crumb: round(first.getBoundingClientRect().left - mainBox.left),
    bar: barFirst ? round(barFirst.getBoundingClientRect().left - mainBox.left) : null,
    content: content == null ? null : round(content - mainBox.left),
    gap: contentTop == null ? null : round(contentTop - top),
    headerHeight: phone ? null : round(headerBox.height),
    pad: {
      x: px('--page-pad-x', 32) - (phone ? 0 : 0),
      top: px('--page-pad-top', 24),
      header: px('--page-header-h', 56),
    },
  };
}

// The overlays of the seeded project, opened one after the other and measured (O102, O103).
async function overlayScenes(page, { phone }) {
  const measure = () =>
    page.evaluate(() => {
      const roots = [
        ...document.querySelectorAll('.ds-side-panel[data-open="true"], .ds-modal'),
      ].filter((element) => element.getBoundingClientRect().width > 0);
      const root = roots.at(-1);
      if (!root) return null;
      const head = root.querySelector('.ds-panel-head');
      const box = (element) => {
        const b = element.getBoundingClientRect();
        return {
          x: Math.round(b.x * 10) / 10,
          y: Math.round(b.y * 10) / 10,
          w: Math.round(b.width * 10) / 10,
          h: Math.round(b.height * 10) / 10,
        };
      };
      const own = box(root);
      const style = getComputedStyle(root);
      const body = root.querySelector('.ds-overlay-body') ?? root.querySelector('.ds-modal-pane');
      const bodyStyle = body && getComputedStyle(body);
      const flush = !!body?.classList.contains('is-flush');
      return {
        kind: root.classList.contains('ds-modal') ? 'modal' : 'panel',
        box: own,
        viewport: innerWidth,
        radius: style.borderTopLeftRadius,
        bg: style.backgroundColor,
        head: {
          ...box(head),
          padL: parseFloat(getComputedStyle(head).paddingLeft),
          padR: parseFloat(getComputedStyle(head).paddingRight),
        },
        tab: head.querySelector('[role=tab]') ? box(head.querySelector('[role=tab]')) : null,
        controls: [...head.querySelectorAll('[data-control]')].map((button) => ({
          c: button.dataset.control,
          ...box(button),
          icon: button.querySelector('svg')?.getBoundingClientRect().width,
        })),
        padded: !flush && !!body && !!root.querySelector('.ds-overlay-body'),
        bodyPad: bodyStyle
          ? [
              bodyStyle.paddingTop,
              bodyStyle.paddingRight,
              bodyStyle.paddingBottom,
              bodyStyle.paddingLeft,
            ].join(' ')
          : null,
        rightGap: Math.round(innerWidth - own.x - own.w),
        topGap: own.y,
        expected: { headHeight: 56, bodyPad: '24px 24px 24px 24px', radius: '16px' },
      };
    });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const open = {
    chat: async () => {
      await page.goto(`${web}/project/${project}`, { waitUntil: 'load' });
      await settle(1200);
      await page.locator('.ds-dock').first().click();
    },
    task: async () => {
      await page.goto(`${web}/project/${project}`, { waitUntil: 'load' });
      await settle(1500);
      await page.locator('.board-card-title').first().click();
    },
    agent: async () => {
      if (!process.env.UI_AUDIT_AGENT) throw new Error('UI_AUDIT_AGENT fehlt');
      await page.goto(`${web}/?agentSheet=${process.env.UI_AUDIT_AGENT}`, { waitUntil: 'load' });
    },
    file: async () => {
      await page.goto(`${web}/project/${project}/files?path=Docs`, { waitUntil: 'load' });
      await settle(1500);
      await page.locator('[data-row-button]').first().click();
    },
    settings: async () => {
      await page.goto(`${web}/project/${project}`, { waitUntil: 'load' });
      await settle(1200);
      await page.keyboard.press('Meta+,');
    },
  };
  const scenes = {};
  for (const [name, action] of Object.entries(open)) {
    try {
      await action();
      await settle(1500);
      const found = await measure();
      if (!found) throw new Error('nicht geöffnet');
      scenes[name] = found;
      // Esc: full screen first, then the overlay (the task's overlay is the reference).
      if (name === 'task') {
        const full = page.locator('.ds-overlay [data-control="full"]');
        await full.click();
        await settle(300);
        await page.keyboard.press('Escape');
        await settle(400);
        const fullAfterEsc = await page.evaluate(
          () => document.querySelector('.ds-overlay')?.getAttribute('data-full') === 'true',
        );
        const openAfterFirst = await page.evaluate(() => !!document.querySelector('.ds-overlay'));
        await page.keyboard.press('Escape');
        await settle(400);
        const openAfterSecond = await page.evaluate(() => !!document.querySelector('.ds-overlay'));
        scenes[name].esc = { fullAfterEsc, openAfterFirst, openAfterSecond };
        // Pinned: the main area gets as narrow as the overlay is wide, and the overlay stays
        // on the next page; unpinned, the room is back.
        if (!phone) {
          await page.locator('.board-card-title').first().click();
          await settle(900);
          const mainOf = () =>
            page.evaluate(() => {
              const main = document.querySelector('.ds-main').getBoundingClientRect();
              const header = document.querySelector('.ds-page-header').getBoundingClientRect();
              const overlay = document.querySelector('.ds-overlay')?.getBoundingClientRect();
              return {
                main: { right: main.right, width: main.width },
                header: { right: header.right },
                overlay: overlay ? { left: overlay.left, width: overlay.width } : null,
              };
            });
          const before = await mainOf();
          await page.locator('.ds-overlay [data-control="pin"]').click();
          await settle(600);
          const after = await mainOf();
          await page.goto(`${web}/project/${project}/initiatives`, { waitUntil: 'load' });
          await settle(1500);
          const elsewhere = await page.evaluate(() => !!document.querySelector('.ds-overlay'));
          await page.locator('.ds-overlay [data-control="pin"]').click();
          await settle(600);
          const released = await mainOf();
          scenes[name].dock = {
            mainBefore: before.main,
            mainAfter: after.main,
            headerAfter: after.header,
            overlayLeft: after.overlay?.left ?? 0,
            overlayWidth: after.overlay?.width ?? 0,
            stillOpenOnOtherPage: elsewhere,
            mainReleased: released.main,
          };
          await page.keyboard.press('Escape');
        }
      }
    } catch (error) {
      scenes[name] = { error: String(error.message ?? error).slice(0, 120) };
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return scenes;
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
    // The template's padding holds for the padded variants; 'bleed' has none by design.
    const padded = (r) => r.spacing && r.spacing.variant !== 'bleed';
    const padLeft = mode(group.filter(padded).map((r) => r.spacing.padLeft));
    const padTop = mode(group.filter(padded).map((r) => r.spacing.padTop));
    for (const r of group) {
      const tag = `${r.theme}/${r.width} ${r.route}`;
      if (r.page && r.page.color !== pageColor)
        out.push(
          `${tag}: Seitenfläche ${r.page.color} (${r.page.token ?? 'kein Token'}) statt ${pageColor}`,
        );
      for (const offender of r.offenders)
        out.push(`${tag}: Fläche ohne Token ${offender.color} an ${offender.at}`);
      for (const white of r.white) out.push(`${tag}: Weiß im Dunkeln an ${white.at}`);
      if (padded(r) && (r.spacing.padLeft !== padLeft || r.spacing.padTop !== padTop))
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
  const overlays = [];
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
        const edges = await page.evaluate(measureEdges).catch(() => ({ none: true }));
        results.push({ route, theme, width, ...measured, edges });
      }
      if (!args['no-overlays']) {
        const scenes = await overlayScenes(page, { phone: width < 1024 });
        overlays.push({ theme, width, scenes });
      }
      await context.close();
    }
  await browser.close();
  const report = {
    at: new Date().toISOString(),
    results,
    overlays,
    findings: [
      ...findings(results),
      ...edgeFindings(results),
      ...overlays.flatMap((entry) => overlayFindings(entry.scenes, entry)),
    ],
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
  console.log(`${results.length} Ansichten, ${report.findings.length} Befunde`);
  for (const finding of report.findings) console.log(`  ${finding}`);
  process.exitCode = report.findings.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
