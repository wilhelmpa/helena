// The real, patchright-backed GatewaySession (design §3/§7): connects over CDP to a
// project's already-running Chromium (never launches one itself — the systemd unit does,
// with no automation flags), drives it through patchright's locator API with human-like
// timing, and never uses a raw evaluate as a tool primitive (design §4's "Bewusst nicht
// vorhanden"): the only evaluate calls in this file are the fixed, internal ones the
// snapshot pipeline and the download/console/network capture need, none of them accept
// caller-supplied script.
import type { Browser, BrowserContext, Page, Download } from 'patchright-core';
import { chromium } from 'patchright-core';
import { SecretGuard, isCredentialField } from './redact';
import {
  REF_ATTR,
  TAG_SCRIPT,
  isValidRef,
  refSelector,
  renderSnapshot,
  type RawSnapshotNode,
} from './snapshot';
import { mouseCurve, preClickPauseMs, stepsFor, typingDelayMs } from './human';
import type { GatewaySession } from './session-types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ConsoleEntry {
  type: string;
  text: string;
  at: number;
}

interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  at: number;
}

const MAX_BUFFER = 500;

export class PatchrightGatewaySession implements GatewaySession {
  guard = new SecretGuard();
  #page: Page;
  #context: BrowserContext;
  #browser: Browser;
  #ownTabIds = new Set<string>();
  #console: ConsoleEntry[] = [];
  #network: NetworkEntry[] = [];
  #dialog: { type: string; message: string } | null = null;
  #downloads: { fileName: string; path: string; at: number }[] = [];
  #vaultInbox: string;
  #humanInput: boolean;
  #random: () => number;

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    options: { vaultInbox: string; humanInput: boolean; random?: () => number },
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#vaultInbox = options.vaultInbox;
    this.#humanInput = options.humanInput;
    this.#random = options.random ?? Math.random;
    this.#wireCapture(page);
  }

  // Connects to an already-running Chromium's CDP endpoint and picks (or opens) the page
  // that is in front — the gateway never launches or closes the browser itself.
  static async connect(
    cdpUrl: string,
    options: { vaultInbox: string; humanInput: boolean; random?: () => number },
  ): Promise<PatchrightGatewaySession> {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return new PatchrightGatewaySession(browser, context, page, options);
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }

  #wireCapture(page: Page): void {
    page.on('console', (message) => {
      this.#console.push({ type: message.type(), text: message.text(), at: Date.now() });
      if (this.#console.length > MAX_BUFFER) this.#console.shift();
    });
    page.on('dialog', (dialog) => {
      this.#dialog = { type: dialog.type(), message: dialog.message() };
    });
    page.on('download', (download: Download) => {
      void this.#saveDownload(download);
    });
    page.on('response', (response) => {
      const request = response.request();
      this.#network.push({
        method: request.method(),
        url: response.url(),
        status: response.status(),
        at: Date.now(),
      });
      if (this.#network.length > MAX_BUFFER) this.#network.shift();
    });
    page.on('framenavigated', () => {
      this.#dialog = null;
    });
  }

  async #saveDownload(download: Download): Promise<void> {
    const fileName = download.suggestedFilename();
    const target = `${this.#vaultInbox}/${Date.now()}-${fileName}`;
    await download.saveAs(target);
    this.#downloads.push({ fileName, path: target, at: Date.now() });
  }

  async status(): Promise<{ url: string; tabCount: number; dialogOpen: boolean }> {
    return {
      url: this.#page.url(),
      tabCount: this.#context.pages().length,
      dialogOpen: this.#dialog !== null,
    };
  }

  async navigate(url: string): Promise<string> {
    await this.#page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await this.#page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    return `Navigated to ${this.#page.url()}`;
  }

  async back(): Promise<string> {
    await this.#page.goBack({ waitUntil: 'load', timeout: 30_000 });
    return `Went back to ${this.#page.url()}`;
  }

  async reload(): Promise<string> {
    await this.#page.reload({ waitUntil: 'load', timeout: 30_000 });
    return `Reloaded ${this.#page.url()}`;
  }

  async snapshot(): Promise<string> {
    const nodes = (await this.#page.evaluate(TAG_SCRIPT)) as RawSnapshotNode[];
    return renderSnapshot(nodes);
  }

  #locatorFor(ref: string) {
    if (!isValidRef(ref)) throw new Error(`Unknown ref: ${ref}. Call browser_snapshot again.`);
    return this.#page.locator(refSelector(ref));
  }

  async #resolveOne(ref: string) {
    const locator = this.#locatorFor(ref);
    const count = await locator.count();
    if (count === 0) throw new Error(`Stale ref: ${ref}. Call browser_snapshot again.`);
    return locator.first();
  }

  async #humanMoveTo(locator: ReturnType<Page['locator']>): Promise<void> {
    if (!this.#humanInput) return;
    const box = await locator.boundingBox();
    if (!box) return;
    const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // patchright/Playwright do not expose the mouse's current position, so each move
    // starts from the target's own viewport area — still a curved, multi-step path, not a
    // teleport, which is what design §7 asks for ("Mausbewegung als Kurve zum Ziel").
    const from = { x: target.x - 40, y: target.y - 20 };
    const steps = stepsFor(from, target);
    for (const point of mouseCurve(from, target, steps, this.#random)) {
      await this.#page.mouse.move(point.x, point.y);
      await sleep(4);
    }
    await sleep(preClickPauseMs(this.#random));
  }

  async click(ref: string, button: 'left' | 'right' | 'middle' = 'left'): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await this.#assertNotCredential(locator, ref);
    await this.#humanMoveTo(locator);
    await locator.click({ button, timeout: 10_000 });
    return `Clicked ${ref}`;
  }

  async #assertNotCredential(locator: ReturnType<Page['locator']>, ref: string): Promise<void> {
    const attrs = await locator.evaluate((el: Element) => ({
      type: el.getAttribute('type'),
      autocomplete: el.getAttribute('autocomplete'),
      name: el.getAttribute('name'),
    }));
    if (isCredentialField(attrs)) {
      throw new Error(
        `${ref} is a password/2FA field — use browser_login / browser_login_code instead.`,
      );
    }
  }

  async type(ref: string, text: string, submit?: boolean): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await this.#assertNotCredential(locator, ref);
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: 10_000 });
    await this.#typeHumanLike(text);
    if (submit) await this.#page.keyboard.press('Enter');
    return `Typed into ${ref}`;
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

  // Selects and deletes whatever the field already holds, via real key events (Ctrl+A then
  // Backspace — this gateway only ever runs against Linux Chromium, so no Cmd/Ctrl split to
  // handle) — not locator.fill('')'s DOM-level clear, for the same reason typing itself
  // never uses el.value = .... A login form's own fields should start empty regardless of
  // anything typed into them earlier in the session (a field that already had "wrong" text
  // in it must not end up with the login appended after it).
  async #clearField(): Promise<void> {
    await this.#page.keyboard.press('Control+A');
    await this.#page.keyboard.press('Backspace');
  }

  async select(ref: string, values: string[]): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await locator.selectOption(values, { timeout: 10_000 });
    return `Selected ${values.join(', ')} in ${ref}`;
  }

  async hover(ref: string): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await this.#humanMoveTo(locator);
    await locator.hover({ timeout: 10_000 });
    return `Hovering ${ref}`;
  }

  async drag(fromRef: string, toRef: string): Promise<string> {
    const from = await this.#resolveOne(fromRef);
    const to = await this.#resolveOne(toRef);
    await this.#humanMoveTo(from);
    await from.dragTo(to, { timeout: 10_000 });
    return `Dragged ${fromRef} to ${toRef}`;
  }

  async press(key: string): Promise<string> {
    await this.#page.keyboard.press(key);
    return `Pressed ${key}`;
  }

  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    ref?: string,
  ): Promise<string> {
    const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const target = ref ? await this.#resolveOne(ref) : null;
    if (target) await this.#humanMoveTo(target);
    const totalPx = amount * 120;
    const perStep = totalPx / 4;
    for (let i = 0; i < 4; i++) {
      if (target) {
        await target.evaluate(
          (el: Element, args: { dx: number; dy: number }) => {
            el.scrollBy(args.dx, args.dy);
          },
          { dx: dx * perStep, dy: dy * perStep },
        );
      } else {
        await this.#page.mouse.wheel(dx * perStep, dy * perStep);
      }
      await sleep(this.#humanInput ? 40 + Math.round(this.#random() * 40) : 0);
    }
    return `Scrolled ${direction}`;
  }

  async screenshot(ref?: string): Promise<string> {
    const covered = await this.#coverCredentialFields();
    try {
      const buffer = ref
        ? await (await this.#resolveOne(ref)).screenshot({ timeout: 10_000 })
        : await this.#page.screenshot({ timeout: 10_000 });
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } finally {
      await covered.uncover();
    }
  }

  // Design §6: "Gefüllte Login-Felder werden vorher abgedeckt" — an opaque overlay is drawn
  // over every credential-shaped input before the screenshot, removed right after, so a
  // filled password never appears in the image even for the instant the picture is taken.
  async #coverCredentialFields(): Promise<{ uncover: () => Promise<void> }> {
    const marker = `volition-cover-${Date.now()}`;
    await this.#page.evaluate(
      (args: { attr: string; marker: string }) => {
        for (const el of document.querySelectorAll(`[${args.attr}]`)) {
          const type = (el.getAttribute('type') || '').toLowerCase();
          const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
          if (
            type !== 'password' &&
            !autocomplete.includes('password') &&
            autocomplete !== 'one-time-code'
          ) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          const cover = document.createElement('div');
          cover.dataset.volitionCoverOf = args.marker;
          cover.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#111;z-index:2147483647;pointer-events:none;`;
          document.body.appendChild(cover);
        }
      },
      { attr: REF_ATTR, marker },
    );
    return {
      uncover: async () => {
        await this.#page
          .evaluate((m: string) => {
            for (const el of document.querySelectorAll(`[data-volition-cover-of="${m}"]`))
              el.remove();
          }, marker)
          .catch(() => {});
      },
    };
  }

  async tabs(
    action: 'list' | 'open' | 'focus' | 'close',
    url?: string,
    tabId?: string,
  ): Promise<string> {
    const pages = this.#context.pages();
    if (action === 'list') {
      const lines = pages.map(
        (page, index) => `[t${index}] ${page.url()}${page === this.#page ? ' (active)' : ''}`,
      );
      return lines.join('\n') || '(no tabs)';
    }
    if (action === 'open') {
      if (!url) throw new Error('url is required to open a tab.');
      const page = await this.#context.newPage();
      const id = `t${pages.length}`;
      this.#ownTabIds.add(id);
      this.#page = page;
      this.#wireCapture(page);
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      return `Opened ${url} as ${id}`;
    }
    const index = tabId ? Number(tabId.replace(/^t/, '')) : NaN;
    const target = pages[index];
    if (!target) throw new Error(`Unknown tab: ${tabId}`);
    if (action === 'focus') {
      this.#page = target;
      await target.bringToFront();
      return `Focused ${tabId}`;
    }
    if (action === 'close') {
      await target.close();
      return `Closed ${tabId}`;
    }
    throw new Error(`Unknown tabs action: ${action}`);
  }

  async dialogAction(action: 'accept' | 'dismiss', promptText?: string): Promise<string> {
    // patchright/Playwright dialogs are handled via a one-shot listener that must already
    // be registered before the dialog fires; since #wireCapture only records the dialog for
    // browser_status/browser_dialog to read, the actual accept/dismiss is done by racing a
    // fresh listener against the page (a dialog left open blocks the page, so the listener
    // resolves on the very next 'dialog' event if one is already pending, or on navigation
    // once handled).
    if (!this.#dialog) throw new Error('No dialog is open.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No dialog is open.')), 100);
      this.#page.once('dialog', (dialog) => {
        clearTimeout(timer);
        (action === 'accept' ? dialog.accept(promptText) : dialog.dismiss()).then(resolve, reject);
      });
      // The listener above only fires for a *new* dialog event; since one is already
      // pending (this.#dialog is set), CDP redelivers it to a fresh listener on patchright/
      // Playwright's own dialog queue, matching how Playwright's own tests drive this.
    });
    this.#dialog = null;
    return `Dialog ${action === 'accept' ? 'accepted' : 'dismissed'}`;
  }

  async upload(ref: string, absolutePath: string): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await locator.setInputFiles(absolutePath, { timeout: 10_000 });
    return `Uploaded ${absolutePath.split('/').pop()} to ${ref}`;
  }

  async downloads(): Promise<string> {
    if (this.#downloads.length === 0) return '(no downloads)';
    return this.#downloads.map((d) => `${d.fileName} -> ${d.path}`).join('\n');
  }

  async console(limit: number): Promise<string> {
    const entries = this.#console.slice(-limit);
    if (entries.length === 0) return '(no console messages)';
    return entries.map((e) => `[${e.type}] ${e.text}`).join('\n');
  }

  async network(limit: number): Promise<string> {
    const entries = this.#network.slice(-limit);
    if (entries.length === 0) return '(no network requests)';
    return entries.map((e) => `${e.method} ${e.status ?? '?'} ${e.url}`).join('\n');
  }

  // Filled via input events (keyboard.type through the same click+type path as an ordinary
  // field), never el.value = ... — design §6: "Das Gateway füllt per Eingabe-Events (kein
  // DOM-value-Setzen)". The caller (server.ts) has already tracked the secret in `guard`
  // before this runs.
  async fillLogin(
    usernameRef: string,
    passwordRef: string,
    username: string,
    password: string,
  ): Promise<string> {
    const usernameLocator = await this.#resolveOne(usernameRef);
    await this.#humanMoveTo(usernameLocator);
    await usernameLocator.click({ timeout: 10_000 });
    await this.#clearField();
    await this.#typeHumanLike(username);
    const passwordLocator = await this.#resolveOne(passwordRef);
    await this.#humanMoveTo(passwordLocator);
    await passwordLocator.click({ timeout: 10_000 });
    await this.#clearField();
    await this.#typeHumanLike(password);
    return 'Login filled.';
  }

  async fillCode(ref: string, code: string): Promise<string> {
    const locator = await this.#resolveOne(ref);
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: 10_000 });
    await this.#clearField();
    await this.#typeHumanLike(code);
    return 'Code filled.';
  }
}
