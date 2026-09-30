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
//   content      (owner 30.09., docs/ui-framework.md §19) the ground is the ground token; every box is THE
//                box (radius 12, surface, card shadow, 16px inside) or an inset; no hand-drawn box (a
//                frame plus a fill without a box class); boxes next to each other 16px apart, sections
//                in <Sections> 32px; every empty state has its symbol, a page's own in one place; the
//                section title is 15/520, the small label 10px, the group head 32px high
//   orb          (owner 30.09.: "Orb verdeckt nichts") on a desktop (>= 900px, where the orb floats at the
//                bottom right) every scroller is scrolled to its end at a short window and nothing that
//                can be read or clicked may lie under the orb;
//   overlays     (O102, O103) the chat panel, a task, an agent, a file, a receipt (UI_AUDIT_RECEIPT=1)
//                and the settings modal are
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
import { contentFindings, edgeFindings, orbFindings, overlayFindings } from './ui-audit-rules.mjs';

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
  '/approvals',
  '/browsers',
  '/activity',
  '/files',
  '/files?kind=files',
  '/schedules',
  '/workflows',
  '/settings',
  '/settings/defaults',
  '/settings/agents',
  '/settings/local-ai',
  '/settings/decisions',
  '/settings/skills',
  '/settings/tools',
  '/settings/access',
  '/settings/voice',
  '/settings/organization',
  '/settings/channels',
  '/settings/server',
  '/settings/updates',
  '/settings/security',
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

// Runs in the page: the content's boxes, distances, empty states and heads (owner 30.09.,
// docs/ui-framework.md §19). Only what the design system's box classes and computed styles tell.
function measureContent() {
  const round = (value) => Math.round(parseFloat(value) * 10) / 10;
  const body = document.querySelector('.ds-page > .ds-page-scroll > .ds-page-body');
  if (!body) return { none: true };
  const probe = document.createElement('div');
  document.body.appendChild(probe);
  const colorOf = (name) => {
    probe.style.backgroundColor = `var(${name})`;
    return getComputedStyle(probe).backgroundColor;
  };
  const tokens = new Map(
    ['--bg', '--surface-1', '--surface-2', '--surface-3'].map((name) => [colorOf(name), name]),
  );
  probe.remove();
  const transparent = (color) =>
    !color || /rgba\(.*,\s*0\)$/.test(color) || color === 'transparent';
  const describe = (element) => {
    const classes =
      typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
  };
  const shadowShows = (value) =>
    value !== 'none' &&
    value.split(/,(?![^(]*\))/).some((layer) => !/rgba\(0, 0, 0, 0\)/.test(layer));
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden'
    );
  };
  // What is drawn inside an overlay, a chart or a dialog is not the page's content.
  const outside = (element) =>
    !element.closest(
      '.ds-side-panel, .ds-overlay, [role=dialog], .react-flow, .ds-modal, [data-radix-popper-content-wrapper]',
    );
  const out = {
    variant: document.querySelector('.ds-page')?.getAttribute('data-page') ?? null,
    ground: null,
    boxes: [],
    rogue: [],
    gaps: [],
    sectionGaps: [],
    empty: [],
    heads: [],
  };
  // The page's ground.
  let ground = null;
  for (let node = body; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (!transparent(color)) {
      ground = color;
      break;
    }
  }
  out.ground = { ok: tokens.get(ground) === '--bg', color: ground };
  const BOX =
    '.ds-card, .ds-list-box, .ds-issue-list-box, .ds-settings-rows, .ds-settings-card, .ds-doc-card, .ds-activity-list, .ds-work-table-card';
  const boxes = [...body.querySelectorAll(BOX)].filter((el) => visible(el) && outside(el));
  for (const el of boxes) {
    const style = getComputedStyle(el);
    const inset = el.matches('.ds-card[data-tone="inset"]');
    const other = el.matches('.ds-card[data-tone="node"], .ds-card[data-tone="popover"]');
    if (other) continue;
    out.boxes.push({
      at: describe(el),
      kind: inset ? 'inset' : el.classList.contains('ds-card') ? 'card' : 'list',
      radius: style.borderTopLeftRadius,
      bg: tokens.get(style.backgroundColor) ?? style.backgroundColor,
      shadow: shadowShows(style.boxShadow),
      // A chosen card (Auswahl) lies one step up on the surface scale (docs/ui-framework.md §19).
      selected: el.classList.contains('is-selected'),
      pad: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        round,
      ),
      // A card that says its own padding (a list or table box, a document, a chart node).
      padVariant: el.matches('[data-pad], [data-layout]') || el.className.includes('doc'),
    });
  }
  // Boxes drawn by hand: a frame and a fill that no box class gave.
  for (const el of body.querySelectorAll('*')) {
    if (!visible(el) || !outside(el)) continue;
    if (
      /^(INPUT|TEXTAREA|SELECT|BUTTON|TABLE|TR|TD|TH|IMG|SVG|CANVAS|IFRAME|VIDEO|PATH|LABEL)$/i.test(
        el.tagName,
      )
    )
      continue;
    if (
      el.matches(
        `${BOX}, .ds-pill, .ds-button, .ds-segmented, [role=button], [role=tab], [role=switch], [data-slot^=input], [data-slot=textarea], [data-slot=select-trigger], [role=group][class*='group/input-group'], .ds-field, .ds-dropzone, .board-card, .kanban-card`,
      )
    )
      continue;
    if (
      el.closest(
        'button, [role=button], [data-slot^=input], [class*="group/input-group"], .ds-pill, .ds-field, .ds-segmented, .ds-list-row, .kanban-card, .board-card, .ds-issue-list-box, .ds-work-table-card',
      )
    )
      continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 32) continue;
    if (parseFloat(style.borderTopLeftRadius) >= 100) continue;
    const framed =
      parseFloat(style.borderTopWidth) > 0 &&
      !transparent(style.borderTopColor) &&
      style.borderTopStyle !== 'dashed';
    const filled =
      !transparent(style.backgroundColor) && tokens.get(style.backgroundColor) !== '--bg';
    if (framed && filled && out.rogue.length < 12) out.rogue.push(describe(el));
  }
  // Distances of boxes that stand next to each other (siblings, nothing between them).
  const parents = new Set(boxes.map((el) => el.parentElement));
  for (const parent of parents) {
    const kids = [...parent.children].filter(visible);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1];
      const b = kids[i];
      if (!a.matches(BOX) || !b.matches(BOX)) continue;
      if (a.matches('[data-tone]') || b.matches('[data-tone]')) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const sameRow = Math.abs(ra.top - rb.top) < 4;
      const gap = sameRow ? rb.left - ra.right : rb.top - ra.bottom;
      // A grid row that wrapped, a list of boxes that share an edge: not a gap to judge.
      if (!sameRow && rb.top < ra.bottom - 1) continue;
      if (gap < 0 || gap > 80) continue;
      out.gaps.push({ a: describe(a), b: describe(b), gap: round(gap) });
    }
  }
  // Sections stand one section gap apart.
  for (const wrapper of body.querySelectorAll('.ds-sections')) {
    const kids = [...wrapper.children].filter(visible);
    for (let i = 1; i < kids.length; i++) {
      const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
      out.sectionGaps.push({ a: describe(kids[i - 1]), b: describe(kids[i]), gap: round(gap) });
    }
  }
  // Empty states: with a symbol; a page's own one is a block of one height (60vh), so its symbol
  // sits in the same place on every page.
  for (const el of body.querySelectorAll('.ds-empty')) {
    if (!visible(el) || !outside(el)) continue;
    out.empty.push({
      icon: !!el.querySelector('.ds-empty-icon'),
      fill: el.hasAttribute('data-fill'),
      height: Math.round(el.getBoundingClientRect().height),
      expected: Math.round(Math.max(240, innerHeight * 0.6)),
    });
  }
  // Heads: one section title, one small label, one group head.
  const text = (el) => (el.textContent ?? '').trim().slice(0, 30);
  for (const el of body.querySelectorAll(
    '.ds-section-title, .ds-settings-group-head h3, .ds-settings-section-head h3',
  )) {
    if (!visible(el) || !outside(el)) continue;
    const style = getComputedStyle(el);
    out.heads.push({
      kind: 'section',
      text: text(el),
      size: round(style.fontSize),
      weight: Number(style.fontWeight),
    });
  }
  for (const el of body.querySelectorAll('.ds-mono-label')) {
    if (!visible(el) || !outside(el)) continue;
    out.heads.push({ kind: 'label', text: text(el), size: round(getComputedStyle(el).fontSize) });
  }
  for (const el of body.querySelectorAll('.ds-group-head')) {
    if (!visible(el) || !outside(el)) continue;
    out.heads.push({
      kind: 'group',
      text: text(el),
      height: round(el.getBoundingClientRect().height),
    });
  }
  for (const el of body.querySelectorAll('h2, h3')) {
    if (!visible(el) || !outside(el) || el.classList.contains('sr-only')) continue;
    if (
      el.closest(BOX) ||
      el.closest(
        '.ds-empty, .ds-section-head, .ds-settings-group-head, .ds-settings-section-head, .ds-group-head, .ds-doc-page, .ds-knowledge-viewer, [class*=prose], .ds-org, .ds-goals, .ds-gallery-column, .ds-page-header',
      )
    )
      continue;
    if (/(^|\s)ds-/.test(el.className)) continue;
    out.heads.push({ kind: 'stray', text: text(el), at: describe(el) });
  }
  return out;
}

// Runs in the page (desktop, after the window was made short): every scroller to its end, then what
// lies under the orb (.ds-dock): something to click, read or see. A large box (a drop zone, a page
// wide block) is not "something under it": its own children are.
function measureOrb() {
  const dock = document.querySelector('.ds-dock');
  const main = document.querySelector('.ds-main');
  if (!dock || !main) return { none: true };
  const rect = dock.getBoundingClientRect();
  const orb = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
  for (let pass = 0; pass < 3; pass++)
    for (const el of main.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
        el.scrollTop = el.scrollHeight;
    }
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [];
    const text = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls.length ? '.' + cls.slice(0, 2).join('.') : ''} "${text}"`;
  };
  // What is visible of an element: its box clipped by every scroller or hidden overflow around it.
  const visible = (el, box) => {
    let clip = { l: box.left, t: box.top, r: box.right, b: box.bottom };
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const around = node.getBoundingClientRect();
      clip = {
        l: Math.max(clip.l, around.left),
        t: Math.max(clip.t, around.top),
        r: Math.min(clip.r, around.right),
        b: Math.min(clip.b, around.bottom),
      };
    }
    return clip.r > clip.l && clip.b > clip.t ? clip : null;
  };
  const hits = [];
  for (const el of main.querySelectorAll('*')) {
    if (el.closest('.ds-dock')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      continue;
    const action = el.matches(
      'a[href], button, input, select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch]',
    );
    const leaf = el.children.length === 0 && (el.textContent ?? '').trim().length > 0;
    if (!action && !leaf) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    // A box that spans most of the page (a drop zone, a card) is not read or clicked at its corner.
    if (action && (box.width > 480 || box.height > 240)) continue;
    const clip = visible(el, box);
    if (!clip) continue;
    // Text is where its lines are, not where its box is (a centred line in a wide empty pane).
    let shapes = [clip];
    if (!action) {
      const range = document.createRange();
      range.selectNodeContents(el);
      shapes = [...range.getClientRects()]
        .map((line) => ({
          l: Math.max(line.left, clip.l),
          t: Math.max(line.top, clip.t),
          r: Math.min(line.right, clip.r),
          b: Math.min(line.bottom, clip.b),
        }))
        .filter((line) => line.r > line.l && line.b > line.t);
    }
    if (shapes.some((s) => s.l < orb.r && s.r > orb.l && s.t < orb.b && s.b > orb.t))
      hits.push(`${action ? 'Aktion' : 'Text'} ${describe(el)}`);
  }
  return { hits: [...new Set(hits)].slice(0, 6) };
}

// Runs in the page: where the header, the toolbar row and the first content start (O92, O104).
function measureEdges() {
  // A shadow of only transparent layers (a hover outline kept for later) is no box.
  const shadowShows = (value) =>
    value !== 'none' &&
    value.split(/,(?![^(]*\))/).some((layer) => !/rgba\(0, 0, 0, 0\)/.test(layer));
  const main = document.querySelector('.ds-main');
  const header = document.querySelector('.ds-page-header');
  if (!main || !header) return { none: true };
  const round = (value) => Math.round(value * 10) / 10;
  const mainBox = main.getBoundingClientRect();
  const headerBox = header.getBoundingClientRect();
  const visible = (element) => element && getComputedStyle(element).display !== 'none';
  const menu = header.querySelector('.ds-page-menu-button');
  const bar = header.querySelector('.ds-page-bar');
  const phone = innerWidth < 900;
  // The breadcrumb and title are switched off from 900px up (PAGE_HEADING_VISIBLE, layout/pageChrome.ts):
  // then the bar's first control starts the header; a bar without controls starts nothing.
  const headingHidden = !phone && header.getAttribute('data-heading') === 'hidden';
  const barControls = visible(bar)
    ? [...bar.querySelectorAll('button, a, input, nav, [role=tablist]')].filter(
        (element) => element.getBoundingClientRect().width > 0,
      )
    : [];
  const first = visible(menu)
    ? menu.querySelector('svg')
    : headingHidden
      ? (barControls[0] ?? null)
      : header.querySelector('.ds-page-crumb, .ds-page-title');
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
    // A full-width wrapper is no content; a card wider than the page (a table that scrolls
    // sideways) that starts inside it is.
    if (box.left < mainBox.left - 1) continue;
    if (box.width > mainBox.width - 8 && box.left <= mainBox.left + 1) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      continue;
    if (style.position === 'fixed') continue;
    const boxed =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0 ||
      shadowShows(style.boxShadow);
    const text = [...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!boxed && !text && element.tagName !== 'svg' && element.tagName !== 'IMG') continue;
    const cls =
      typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
    items.push({
      left: box.left,
      top: box.top,
      boxed,
      at: `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
    });
  }
  const content = items.length ? Math.min(...items.map((item) => item.left)) : null;
  const leftmost = items.find((item) => item.left === content)?.at ?? null;
  const contentTop = items.length ? Math.min(...items.map((item) => item.top)) : null;
  const rootStyle = getComputedStyle(document.documentElement);
  const px = (name, fallback) => parseFloat(rootStyle.getPropertyValue(name)) || fallback;
  return {
    variant: document.querySelector('.ds-page')?.getAttribute('data-page') ?? null,
    headers: document.querySelectorAll('.ds-page-header').length,
    // A second toolbar row or a path line under the bar (O104): none may be left.
    stray: document.querySelectorAll(
      '.ds-main > .ds-page-toolbar, .ds-page-crumbs ~ .ds-page-crumbs',
    ).length,
    phone,
    // Nothing in the bar (switched-off heading, no controls): the page's own padding is the reference.
    crumb: first ? round(first.getBoundingClientRect().left - mainBox.left) : null,
    headingHidden,
    bar: barFirst ? round(barFirst.getBoundingClientRect().left - mainBox.left) : null,
    content: content == null ? null : round(content - mainBox.left),
    contentAt: leftmost,
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
        expected: {
          headHeight: 56,
          bodyPad: '24px 24px 24px 24px',
          radius: '16px',
          // A touch screen gets the finger's 40px, a pointer 32px.
          control: matchMedia('(pointer: coarse)').matches ? 40 : 32,
        },
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
      await page
        .locator('.board-card-title')
        .first()
        .evaluate((element) => element.click());
    },
    agent: async () => {
      if (!process.env.UI_AUDIT_AGENT) throw new Error('UI_AUDIT_AGENT fehlt');
      await page.goto(`${web}/?agentSheet=${process.env.UI_AUDIT_AGENT}`, {
        waitUntil: 'domcontentloaded',
      });
      // The dialog opens once the page has hydrated (a first load can take a while).
      await page
        .waitForSelector('.ds-side-panel[data-open="true"]', { timeout: 20_000 })
        .catch(() => {});
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
    }, // Needs a receipt in the project (UI_AUDIT_RECEIPT=1): the receipt overlay.
    ...(process.env.UI_AUDIT_RECEIPT
      ? {
          receipt: async () => {
            await page.goto(`${web}/project/${project}/receipts`, { waitUntil: 'load' });
            await settle(1500);
            await page.locator('[data-row-button]').first().click();
          },
        }
      : {}),
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
          await page
            .locator('.board-card-title')
            .first()
            .evaluate((element) => element.click());
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
    const padded = (r) =>
      r.spacing && r.spacing.variant !== 'bleed' && r.spacing.variant !== 'split';
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
        if (!page.url().startsWith(web))
          await page.goto(`${web}/`, { waitUntil: 'load', timeout: 180_000 });
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
        const content = await page.evaluate(measureContent).catch(() => ({ none: true }));
        // The orb floats over the page on a desktop; a short window makes every page scroll.
        let orb = { none: true };
        if (width >= 900) {
          await page.setViewportSize({ width, height: 600 });
          await page.waitForTimeout(400);
          orb = await page.evaluate(measureOrb).catch(() => ({ none: true }));
          await page.setViewportSize({ width, height: 900 });
        }
        results.push({ route, theme, width, ...measured, edges, content, orb });
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
      ...contentFindings(results),
      ...orbFindings(results),
      ...overlays.flatMap((entry) => overlayFindings(entry.scenes, entry)),
    ],
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
  console.log(`${results.length} Ansichten, ${report.findings.length} Befunde`);
  for (const finding of report.findings) console.log(`  ${finding}`);
  process.exitCode = report.findings.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
