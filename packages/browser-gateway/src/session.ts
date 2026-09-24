// The real, patchright-backed GatewaySession (design §3/§7): connects over CDP to a
// project's already-running Chromium (never launches one itself — the systemd unit does,
// with no automation flags), drives it through patchright's locator API with human-like
// timing, and never offers a raw evaluate as a tool (design §4's "Bewusst nicht
// vorhanden"): the only evaluate calls in this file are the fixed, internal ones below,
// none of them runs caller-supplied script, and patchright runs them in an isolated world.
import { readFile, stat } from 'node:fs/promises';
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Dialog,
  Download,
  ElementHandle,
  Locator,
  Page,
  Route,
} from 'patchright-core';
import { chromium } from 'patchright-core';
import { SecretGuard, isCredentialField } from './redact.ts';
import {
  CREDENTIAL_SELECTOR,
  isValidRef,
  redactValues,
  refSelector,
  truncateSnapshot,
} from './snapshot.ts';
import { mouseCurve, preClickPauseMs, stepsFor, typingDelayMs } from './human.ts';
import { hostAllowed, type DomainPolicy } from './domain.ts';
import { maskPng, type Rect } from './png.ts';
import type {
  BrowserStatus,
  GatewaySession,
  ToolOutput,
  UploadFile,
} from './session-types.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ConsoleEntry {
  tab: string;
  type: string;
  text: string;
}

interface NetworkEntry {
  tab: string;
  method: string;
  url: string;
  status: number;
}

const MAX_BUFFER = 500;
const ACTION_TIMEOUT_MS = 10_000;
const LOAD_TIMEOUT_MS = 30_000;
export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

// Query values that authenticate (an OAuth code, a magic-link token, a signature) are
// replaced in what browser_network reports; the rest of a URL stays readable.
const SENSITIVE_PARAM = /token|code|secret|key|pass|session|sig|auth|ticket|otp/i;

export function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value.slice(0, 500);
  }
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
  }
  for (const [name] of [...url.searchParams]) {
    if (SENSITIVE_PARAM.test(name)) url.searchParams.set(name, '…');
  }
  url.hash = url.hash && SENSITIVE_PARAM.test(url.hash) ? '#…' : url.hash;
  return url.toString().slice(0, 500);
}

// A downloaded file's name as the vault gets it: no directory part, no control characters,
// nothing hidden, bounded in length.
export function safeDownloadName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'download';
}

export interface SessionOptions {
  humanInput: boolean;
  random?: () => number;
  // Stores a finished download (the vault Inbox of the project, through Helena) and returns
  // where it went. Without it, downloads are listed but not kept.
  onDownload?: (fileName: string, bytes: Buffer) => Promise<string>;
}

export class PatchrightGatewaySession implements GatewaySession {
  guard = new SecretGuard();
  #browser: Browser;
  #context: BrowserContext;
  #page: Page;
  #connected = true;
  #tabIds = new WeakMap<Page, string>();
  #nextTab = 1;
  #tabOwners = new Map<Page, number>();
  #wired = new WeakSet<Page>();
  #console: ConsoleEntry[] = [];
  #network: NetworkEntry[] = [];
  // The pending Dialog object per page: a dialog event fires once per real dialog, and
  // accept/dismiss has to happen on that same object.
  #dialogs = new Map<Page, Dialog>();
  #downloads: { fileName: string; savedAs: string; at: number }[] = [];
  // The fields a secret was typed into, so a screenshot covers them whatever the page does
  // to them afterwards ("Passwort anzeigen" turns a password field into a text field).
  #filled: ElementHandle[] = [];
  #humanInput: boolean;
  #random: () => number;
  #onDownload: SessionOptions['onDownload'];
  #policyJson: string | null = null;
  #routeHandler: ((route: Route) => Promise<void>) | null = null;
  // Told when a page opens a dialog, so an action it blocks can return (see #orDialog).
  #dialogListeners = new Set<(page: Page, dialog: Dialog) => void>();
  #logSessions = new WeakMap<Page, CDPSession>();

  private constructor(browser: Browser, context: BrowserContext, page: Page, options: SessionOptions) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#humanInput = options.humanInput;
    this.#random = options.random ?? Math.random;
    this.#onDownload = options.onDownload;
    browser.on('disconnected', () => {
      this.#connected = false;
    });
    for (const existing of context.pages()) this.#wire(existing);
    // Every tab, also one the page or the person opens, is wired: its console, network and
    // downloads are captured, and it has a dialog listener — without one, patchright would
    // dismiss every dialog of that tab on its own, including one the person is answering in
    // the live view.
    context.on('page', (opened) => this.#wire(opened));
  }

  // Connects to an already-running Chromium's CDP endpoint and starts on the tab in front —
  // the gateway never launches or closes the browser itself.
  static async connect(cdpUrl: string, options: SessionOptions): Promise<PatchrightGatewaySession> {
    const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const pages = context.pages();
    let page = pages[0];
    for (const candidate of pages) {
      const state = await candidate
        .evaluate(() => document.visibilityState)
        .catch(() => 'hidden' as const);
      if (state === 'visible') {
        page = candidate;
        break;
      }
    }
    return new PatchrightGatewaySession(browser, context, page ?? (await context.newPage()), options);
  }

  isConnected(): boolean {
    return this.#connected && this.#browser.isConnected();
  }

  // Never browser.close(): on a DevTools connection that could end the project's browser
  // itself, which belongs to its systemd unit. A session is dropped instead, and the
  // connection ends with the process.

  setHumanInput(value: boolean): void {
    this.#humanInput = value;
  }

  #tabId(page: Page): string {
    let id = this.#tabIds.get(page);
    if (!id) {
      id = `t${this.#nextTab++}`;
      this.#tabIds.set(page, id);
    }
    return id;
  }

  #wire(page: Page): void {
    if (this.#wired.has(page)) return;
    this.#wired.add(page);
    const tab = this.#tabId(page);
    // What the browser logs for the tab (failed requests, blocked content, security
    // warnings). The page's own console.log is not among it: reading that needs the
    // Runtime domain, the classic sign of an automated browser, which patchright avoids.
    void this.#context
      .newCDPSession(page)
      .then(async (cdp) => {
        this.#logSessions.set(page, cdp);
        cdp.on('Log.entryAdded', (event: { entry: { level: string; source: string; text: string; url?: string } }) => {
          const entry = event.entry;
          this.#console.push({
            tab,
            type: `${entry.source}/${entry.level}`,
            text: `${entry.text}${entry.url ? ` (${redactUrl(entry.url)})` : ''}`.slice(0, 2000),
          });
          if (this.#console.length > MAX_BUFFER) this.#console.shift();
        });
        await cdp.send('Log.enable');
      })
      .catch(() => {});
    page.on('dialog', (dialog) => {
      this.#dialogs.set(page, dialog);
      for (const listener of [...this.#dialogListeners]) listener(page, dialog);
    });
    // Every download of the browser — an agent's, or the owner's in the live view. Chromium
    // saves it into patchright's artifacts directory, which is below this process's TMPDIR:
    // the router unit points that at a directory the browser units may write
    // (volition-project-browser-router.service).
    page.on('download', (download) => {
      void this.#keepDownload(download);
    });
    page.on('response', (response) => {
      this.#network.push({
        tab,
        method: response.request().method(),
        url: redactUrl(response.url()),
        status: response.status(),
      });
      if (this.#network.length > MAX_BUFFER) this.#network.shift();
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.#dialogs.delete(page);
    });
    page.on('close', () => {
      this.#dialogs.delete(page);
      this.#tabOwners.delete(page);
      if (page === this.#page) {
        const remaining = this.#context.pages().filter((candidate) => !candidate.isClosed());
        if (remaining.length > 0) this.#page = remaining[remaining.length - 1]!;
      }
    });
  }

  async #keepDownload(download: Download): Promise<void> {
    const fileName = safeDownloadName(download.suggestedFilename());
    try {
      const file = await download.path();
      // The completion event can arrive a moment before Chromium has renamed the file.
      let size = -1;
      for (let attempt = 0; attempt < 50 && size < 0; attempt++) {
        size = await stat(file).then(
          (info) => info.size,
          () => -1,
        );
        if (size < 0) await sleep(100);
      }
      if (size < 0) throw new Error('the browser did not save the file');
      if (size > MAX_TRANSFER_BYTES) {
        this.#downloads.push({ fileName, savedAs: '(larger than 50 MB, not kept)', at: Date.now() });
        return;
      }
      const savedAs = this.#onDownload
        ? await this.#onDownload(fileName, await readFile(file))
        : '(not kept)';
      this.#downloads.push({ fileName, savedAs, at: Date.now() });
    } catch (error) {
      this.#downloads.push({
        fileName,
        savedAs: `(failed: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'})`,
        at: Date.now(),
      });
    } finally {
      if (this.#downloads.length > 100) this.#downloads.shift();
      await download.delete().catch(() => {});
    }
  }

  // An action a page answers with a dialog (confirm, alert, a leave-page prompt) does not
  // finish until the dialog is answered — which the agent can only do once the tool returns.
  // So a tool returns as soon as a dialog opens, saying so; the action finishes in the
  // background once browser_dialog answers it.
  async #orDialog(action: Promise<string>): Promise<string> {
    const page = this.#page;
    let off = () => {};
    const opened = new Promise<Dialog>((resolve) => {
      const listener = (from: Page, dialog: Dialog) => {
        if (from === page) resolve(dialog);
      };
      this.#dialogListeners.add(listener);
      off = () => this.#dialogListeners.delete(listener);
    });
    try {
      const first = await Promise.race([
        action.then((text) => ({ text })),
        opened.then((dialog) => ({ dialog })),
      ]);
      if ('text' in first) return first.text;
      action.catch(() => {});
      return (
        `A ${first.dialog.type()} dialog opened: "${first.dialog.message().slice(0, 300)}". ` +
        'Answer it with browser_dialog (accept or dismiss) before anything else.'
      );
    } finally {
      off();
    }
  }

  // Nothing but the dialog can be done on a page that shows one.
  #assertNoDialog(): void {
    const dialog = this.#dialogs.get(this.#page);
    if (dialog) {
      throw new Error(
        `A ${dialog.type()} dialog is open: "${dialog.message().slice(0, 200)}". Answer it with browser_dialog first.`,
      );
    }
  }

  async status(): Promise<BrowserStatus> {
    return {
      url: this.#page.url(),
      title: await this.#page.title().catch(() => ''),
      tabCount: this.#context.pages().length,
      dialogOpen: this.#dialogs.has(this.#page),
    };
  }

  // Design §8: the project's domain block/allowlist, for every request of every tab —
  // a link click, a redirect, an iframe, a tab the page opens. Installed only while a list
  // is set: intercepting every request of every page costs time for nothing otherwise.
  async applyDomainPolicy(policy: DomainPolicy): Promise<void> {
    const json = JSON.stringify(policy);
    if (json === this.#policyJson) return;
    this.#policyJson = json;
    if (this.#routeHandler) {
      await this.#context.unroute('**/*', this.#routeHandler).catch(() => {});
      this.#routeHandler = null;
    }
    if (policy.domainBlocklist.length === 0 && policy.domainAllowlist.length === 0) return;
    this.#routeHandler = async (route) => {
      let host: string;
      try {
        const url = new URL(route.request().url());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
        host = url.hostname;
      } catch {
        return route.continue();
      }
      if (hostAllowed(policy, host)) return route.continue();
      return route.abort('blockedbyclient');
    };
    await this.#context.route('**/*', this.#routeHandler);
  }

  async #describe(): Promise<string> {
    const title = await this.#page.title().catch(() => '');
    return `${this.#page.url()}${title ? ` — "${title.slice(0, 120)}"` : ''}`;
  }

  async #settle(): Promise<void> {
    await this.#page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
    await this.#page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  }

  async navigate(url: string): Promise<string> {
    this.#assertNoDialog();
    return this.#orDialog(
      (async () => {
        await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
        await this.#settle();
        return `Navigated to ${await this.#describe()}. Call browser_snapshot to see the page.`;
      })(),
    );
  }

  async back(): Promise<string> {
    this.#assertNoDialog();
    const response = await this.#page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: LOAD_TIMEOUT_MS,
    });
    if (response === null && this.#page.url() === 'about:blank') return 'There is no page to go back to.';
    await this.#settle();
    return `Went back to ${await this.#describe()}`;
  }

  async reload(): Promise<string> {
    this.#assertNoDialog();
    await this.#page.reload({ waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    await this.#settle();
    return `Reloaded ${await this.#describe()}`;
  }

  // The current values of every credential-shaped field in every frame of the tab, read in
  // the isolated world, never returned: they are what redactValues removes from a snapshot.
  async #credentialValues(): Promise<string[]> {
    const values: string[] = [];
    for (const frame of this.#page.frames()) {
      const found = await frame
        .locator(CREDENTIAL_SELECTOR)
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLInputElement).value ?? ''),
        )
        .catch(() => [] as string[]);
      values.push(...found);
    }
    for (const handle of this.#filled) {
      const value = await handle
        .evaluate((element) => (element as HTMLInputElement).value ?? '')
        .catch(() => '');
      if (value) values.push(value);
    }
    return values;
  }

  async snapshot(): Promise<string> {
    this.#assertNoDialog();
    const text = await this.#page.ariaSnapshot({ mode: 'ai', timeout: 15_000 });
    const clean = redactValues(text, await this.#credentialValues());
    const header = `Tab ${this.#tabId(this.#page)}: ${await this.#describe()}\n`;
    return truncateSnapshot(header + clean);
  }

  #locatorFor(ref: string): Locator {
    if (!isValidRef(ref)) throw new Error(`Unknown ref: ${ref}. Call browser_snapshot again.`);
    return this.#page.locator(refSelector(ref));
  }

  async #resolveOne(ref: string): Promise<Locator> {
    const locator = this.#locatorFor(ref);
    const count = await locator.count().catch(() => 0);
    if (count === 0) throw new Error(`Stale ref: ${ref}. Call browser_snapshot again.`);
    return locator.first();
  }

  async #humanMoveTo(locator: Locator): Promise<void> {
    if (!this.#humanInput) return;
    await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return;
    const target = {
      x: box.x + box.width * (0.35 + this.#random() * 0.3),
      y: box.y + box.height * (0.35 + this.#random() * 0.3),
    };
    // patchright does not expose the pointer's current position, so each move starts a
    // short distance off the target: still a curved, multi-step path, not a teleport.
    const from = { x: target.x - 30 - this.#random() * 40, y: target.y - 10 - this.#random() * 30 };
    const steps = stepsFor(from, target);
    for (const point of mouseCurve(from, target, steps, this.#random)) {
      await this.#page.mouse.move(point.x, point.y);
      await sleep(4);
    }
    await sleep(preClickPauseMs(this.#random));
  }

  async #fieldAttributes(locator: Locator) {
    return locator.evaluate((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type'),
      autocomplete: element.getAttribute('autocomplete'),
      name: element.getAttribute('name'),
    }));
  }

  async #assertNotCredential(locator: Locator, ref: string): Promise<void> {
    if (isCredentialField(await this.#fieldAttributes(locator))) {
      throw new Error(
        `${ref} is a password/2FA field — use browser_login / browser_login_code instead.`,
      );
    }
  }

  async click(ref: string, button: 'left' | 'right' | 'middle' = 'left'): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(ref);
    await this.#humanMoveTo(locator);
    return this.#orDialog(
      (async () => {
        await locator.click({ button, timeout: ACTION_TIMEOUT_MS });
        await this.#page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
        return `Clicked ${ref}. Now on ${await this.#describe()}`;
      })(),
    );
  }

  async type(ref: string, text: string, submit?: boolean): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(ref);
    await this.#assertNotCredential(locator, ref);
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#typeHumanLike(text);
    if (!submit) return `Typed into ${ref}`;
    return this.#orDialog(
      (async () => {
        await this.#page.keyboard.press('Enter');
        await this.#page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
        return `Typed into ${ref} and pressed Enter. Now on ${await this.#describe()}`;
      })(),
    );
  }

  async #typeHumanLike(text: string): Promise<void> {
    if (!this.#humanInput) {
      await this.#page.keyboard.type(text);
      return;
    }
    for (const char of text) {
      await this.#page.keyboard.type(char);
      await sleep(typingDelayMs(this.#random));
    }
  }

  // Selects and deletes whatever the field already holds, with real key events — never a
  // DOM value set: a login field must start empty whatever was typed into it before.
  async #clearField(): Promise<void> {
    await this.#page.keyboard.press('Control+A');
    await this.#page.keyboard.press('Backspace');
  }

  async select(ref: string, values: string[]): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(ref);
    const chosen = await locator.selectOption(values, { timeout: ACTION_TIMEOUT_MS });
    return `Selected ${chosen.join(', ')} in ${ref}`;
  }

  async hover(ref: string): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(ref);
    await this.#humanMoveTo(locator);
    await locator.hover({ timeout: ACTION_TIMEOUT_MS });
    return `Hovering ${ref}`;
  }

  async drag(fromRef: string, toRef: string): Promise<string> {
    this.#assertNoDialog();
    const from = await this.#resolveOne(fromRef);
    const to = await this.#resolveOne(toRef);
    await this.#humanMoveTo(from);
    await from.dragTo(to, { timeout: ACTION_TIMEOUT_MS });
    return `Dragged ${fromRef} to ${toRef}`;
  }

  async press(key: string): Promise<string> {
    this.#assertNoDialog();
    return this.#orDialog(this.#page.keyboard.press(key).then(() => `Pressed ${key}`));
  }

  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    ref?: string,
  ): Promise<string> {
    this.#assertNoDialog();
    const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const target = ref ? await this.#resolveOne(ref) : null;
    if (target) {
      await this.#humanMoveTo(target);
      const box = await target.boundingBox().catch(() => null);
      if (box) await this.#page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    const steps = 4;
    const perStep = (Math.max(1, Math.min(10, amount)) * 120) / steps;
    for (let i = 0; i < steps; i++) {
      // A wheel turn over the element scrolls whatever the page scrolls there, the way a
      // person's wheel does; no script moves the page.
      await this.#page.mouse.wheel(dx * perStep, dy * perStep);
      await sleep(this.#humanInput ? 40 + Math.round(this.#random() * 40) : 0);
    }
    return `Scrolled ${direction}`;
  }

  // The rectangles (CSS pixels, relative to the viewport) a screenshot covers: every
  // credential-shaped field in every frame, and every field the gateway typed a secret into.
  async #coverRects(): Promise<Rect[]> {
    const rects: Rect[] = [];
    for (const frame of this.#page.frames()) {
      const fields = await frame
        .locator(CREDENTIAL_SELECTOR)
        .all()
        .catch(() => [] as Locator[]);
      for (const field of fields) {
        const box = await field.boundingBox({ timeout: 2_000 }).catch(() => null);
        if (box) rects.push(box);
      }
    }
    for (const handle of this.#filled) {
      const box = await handle.boundingBox().catch(() => null);
      if (box) rects.push(box);
    }
    return rects;
  }

  async screenshot(ref?: string): Promise<ToolOutput> {
    this.#assertNoDialog();
    const rects = await this.#coverRects();
    let png: Buffer;
    let offset = { x: 0, y: 0 };
    if (ref) {
      const locator = await this.#resolveOne(ref);
      const box = await locator.boundingBox().catch(() => null);
      if (box) offset = { x: box.x, y: box.y };
      png = await locator.screenshot({ type: 'png', scale: 'css', timeout: ACTION_TIMEOUT_MS });
    } else {
      png = await this.#page.screenshot({ type: 'png', scale: 'css', timeout: ACTION_TIMEOUT_MS });
    }
    let covered: Buffer;
    try {
      covered = maskPng(
        png,
        rects.map((rect) => ({ ...rect, x: rect.x - offset.x, y: rect.y - offset.y })),
      );
    } catch {
      // A picture that cannot be covered is not returned at all.
      if (rects.length > 0) {
        throw new Error('The screenshot could not be taken without showing a login field.');
      }
      covered = png;
    }
    return {
      text: `Screenshot of ${ref ?? 'the viewport'} on ${await this.#describe()}${rects.length ? ` (${rects.length} login field(s) covered)` : ''}`,
      image: { data: covered.toString('base64'), mimeType: 'image/png' },
    };
  }

  async tabs(
    action: 'list' | 'open' | 'focus' | 'close',
    options: { url?: string; tabId?: string; agentId?: number } = {},
  ): Promise<string> {
    const pages = this.#context.pages().filter((page) => !page.isClosed());
    if (action === 'list') {
      const lines = await Promise.all(
        pages.map(async (page) => {
          const title = await page.title().catch(() => '');
          const marks = [
            page === this.#page ? 'active' : null,
            options.agentId !== undefined && this.#tabOwners.get(page) === options.agentId
              ? 'yours'
              : null,
          ].filter(Boolean);
          return `[${this.#tabId(page)}] ${page.url()}${title ? ` — "${title.slice(0, 80)}"` : ''}${marks.length ? ` (${marks.join(', ')})` : ''}`;
        }),
      );
      return lines.join('\n') || '(no tabs)';
    }
    if (action === 'open') {
      if (!options.url) throw new Error('url is required to open a tab.');
      const page = await this.#context.newPage();
      this.#wire(page);
      if (options.agentId !== undefined) this.#tabOwners.set(page, options.agentId);
      this.#page = page;
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await this.#settle();
      return `Opened ${this.#tabId(page)}: ${await this.#describe()}`;
    }
    const target = pages.find((page) => this.#tabId(page) === options.tabId);
    if (!target) throw new Error(`Unknown tab: ${options.tabId}. Call browser_tabs list.`);
    if (action === 'focus') {
      this.#page = target;
      await target.bringToFront();
      return `Focused ${options.tabId}: ${await this.#describe()}`;
    }
    if (action === 'close') {
      if (pages.length === 1) throw new Error('The last tab stays open.');
      await target.close();
      if (target === this.#page) {
        const remaining = this.#context.pages().filter((page) => !page.isClosed());
        this.#page = remaining[remaining.length - 1]!;
        await this.#page.bringToFront().catch(() => {});
      }
      return `Closed ${options.tabId}`;
    }
    throw new Error(`Unknown tabs action: ${action}`);
  }

  // Design §4: the tabs an agent opened close when it gives control back. The last tab of
  // the browser always stays.
  async closeTabsOf(agentId: number): Promise<void> {
    for (const [page, owner] of [...this.#tabOwners]) {
      if (owner !== agentId || page.isClosed()) continue;
      if (this.#context.pages().filter((candidate) => !candidate.isClosed()).length <= 1) break;
      await page.close().catch(() => {});
    }
  }

  async dialogAction(action: 'accept' | 'dismiss', promptText?: string): Promise<string> {
    const dialog = this.#dialogs.get(this.#page);
    if (!dialog) throw new Error('No dialog is open in the active tab.');
    this.#dialogs.delete(this.#page);
    try {
      await (action === 'accept' ? dialog.accept(promptText) : dialog.dismiss());
    } catch {
      return 'The dialog was already answered (from the live view, most likely).';
    }
    return `Dialog ${action === 'accept' ? 'accepted' : 'dismissed'}: "${dialog.message().slice(0, 200)}"`;
  }

  async upload(ref: string, file: UploadFile): Promise<string> {
    this.#assertNoDialog();
    if (file.buffer.length > MAX_TRANSFER_BYTES) throw new Error('The file is larger than 50 MB.');
    const locator = await this.#resolveOne(ref);
    await locator.setInputFiles(
      { name: file.name, mimeType: file.mimeType, buffer: file.buffer },
      { timeout: ACTION_TIMEOUT_MS },
    );
    return `Uploaded ${file.name} (${file.buffer.length} bytes) to ${ref}`;
  }

  async downloads(): Promise<string> {
    if (this.#downloads.length === 0) return '(no downloads)';
    return this.#downloads.map((entry) => `${entry.fileName} -> ${entry.savedAs}`).join('\n');
  }

  async console(limit: number): Promise<string> {
    const entries = this.#console.slice(-Math.max(1, Math.min(200, limit)));
    if (entries.length === 0) return '(no console messages)';
    return entries.map((entry) => `${entry.tab} [${entry.type}] ${entry.text}`).join('\n');
  }

  async network(limit: number): Promise<string> {
    const entries = this.#network.slice(-Math.max(1, Math.min(200, limit)));
    if (entries.length === 0) return '(no network requests)';
    return entries
      .map((entry) => `${entry.tab} ${entry.method} ${entry.status} ${entry.url}`)
      .join('\n');
  }

  async #remember(handle: ElementHandle | null): Promise<void> {
    if (!handle) return;
    this.#filled.push(handle);
    if (this.#filled.length > 16) await this.#filled.shift()?.dispose().catch(() => {});
  }

  async #originOf(locator: Locator): Promise<string> {
    return locator.evaluate(() => location.origin);
  }

  async frameOrigin(ref: string): Promise<string> {
    return this.#originOf(await this.#resolveOne(ref));
  }

  async fillLogin(
    usernameRef: string,
    passwordRef: string,
    username: string,
    password: string,
    origin: string,
  ): Promise<string> {
    this.#assertNoDialog();
    const usernameLocator = await this.#resolveOne(usernameRef);
    const passwordLocator = await this.#resolveOne(passwordRef);
    const passwordField = await this.#fieldAttributes(passwordLocator);
    const isPasswordInput =
      passwordField.tag === 'input' &&
      ((passwordField.type ?? '').toLowerCase() === 'password' ||
        (passwordField.autocomplete ?? '').toLowerCase().includes('password'));
    if (!isPasswordInput) {
      throw new Error(`${passwordRef} is not a password field; the password is typed only into one.`);
    }
    if (isCredentialField(await this.#fieldAttributes(usernameLocator))) {
      throw new Error(`${usernameRef} is a password field, not the username field.`);
    }
    // Right before typing: both fields are still on the origin the login was chosen for.
    if (
      (await this.#originOf(usernameLocator)) !== origin ||
      (await this.#originOf(passwordLocator)) !== origin
    ) {
      throw new Error('The login fields are no longer on the page the login was chosen for.');
    }
    await this.#humanMoveTo(usernameLocator);
    await usernameLocator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#clearField();
    await this.#typeHumanLike(username);
    await this.#humanMoveTo(passwordLocator);
    await passwordLocator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#clearField();
    await this.#remember(await passwordLocator.elementHandle({ timeout: ACTION_TIMEOUT_MS }));
    await this.#typeHumanLike(password);
    return 'Login filled.';
  }

  async fillCode(ref: string, code: string): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(ref);
    const field = await this.#fieldAttributes(locator);
    if (field.tag !== 'input' && field.tag !== 'textarea') {
      throw new Error(`${ref} is not a text field.`);
    }
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#clearField();
    await this.#remember(await locator.elementHandle({ timeout: ACTION_TIMEOUT_MS }));
    await this.#typeHumanLike(code);
    return 'Code filled.';
  }
}
