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
  FileChooser,
  Frame,
  Locator,
  Page,
  Request,
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
import { requestAllowed, type DomainPolicy } from './domain.ts';
import { maskPng, type Rect } from './png.ts';
import {
  GUARD,
  HIT,
  NODE,
  OBSERVE,
  PAGE_KEY,
  type RawFrameObservation,
} from './task/page-script.ts';
import { repeatedLabels } from './task/policy-common.ts';
import { TaskActError, type TaskActInput, type TaskPage } from './task/loop.ts';
import type { PageElement, PageObservation } from './task/types.ts';
import type {
  BrowserStatus,
  ClickOptions,
  ConsoleLevel,
  FormField,
  GatewaySession,
  ToolOutput,
  UploadFile,
} from './session-types.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ConsoleEntry {
  tab: string;
  source: string;
  level: ConsoleLevel;
  text: string;
}

interface NetworkEntry {
  tab: string;
  method: string;
  url: string;
  status: number;
  resourceType: string;
}

const MAX_BUFFER = 500;
const ACTION_TIMEOUT_MS = 10_000;
const LOAD_TIMEOUT_MS = 30_000;
// After an action, how long to wait for what it set off (Playwright MCP's settle time).
const SETTLE_MS = 500;
const MAX_WAIT_SEC = 30;
const CONSOLE_RANK: Record<ConsoleLevel, number> = { error: 0, warning: 1, info: 2, debug: 3 };
// What browser_network_requests leaves out unless asked for (Playwright MCP's "static").
const STATIC_TYPES = new Set(['image', 'font', 'stylesheet', 'script', 'media', 'manifest']);

function consoleLevel(cdpLevel: string): ConsoleLevel {
  if (cdpLevel === 'error') return 'error';
  if (cdpLevel === 'warning') return 'warning';
  if (cdpLevel === 'verbose') return 'debug';
  return 'info';
}
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
  const cleaned = [...base]
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
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
  getPreviewOrigins?: () => Promise<readonly string[]>;
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
  // The file chooser a page opened and waits on (a click on an upload button), answered by
  // browser_file_upload: a modal state, as in Playwright MCP.
  #choosers = new Map<Page, FileChooser>();
  // What happened since the last answer (a download finished), told in the next one.
  #events: string[] = [];
  // The fields a secret was typed into, so a screenshot covers them whatever the page does
  // to them afterwards ("Passwort anzeigen" turns a password field into a text field).
  #filled: ElementHandle[] = [];
  #humanInput: boolean;
  #random: () => number;
  #onDownload: SessionOptions['onDownload'];
  #getPreviewOrigins: SessionOptions['getPreviewOrigins'];
  #policyJson: string | null = null;
  #routeHandler: ((route: Route) => Promise<void>) | null = null;
  // Told when a page opens a dialog, so an action it blocks can return (see #orDialog).
  #dialogListeners = new Set<(page: Page, dialog: Dialog) => void>();
  #logSessions = new WeakMap<Page, CDPSession>();

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    options: SessionOptions,
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#humanInput = options.humanInput;
    this.#random = options.random ?? Math.random;
    this.#onDownload = options.onDownload;
    this.#getPreviewOrigins = options.getPreviewOrigins;
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
    return new PatchrightGatewaySession(
      browser,
      context,
      page ?? (await context.newPage()),
      options,
    );
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
        cdp.on(
          'Log.entryAdded',
          (event: { entry: { level: string; source: string; text: string; url?: string } }) => {
            const entry = event.entry;
            this.#console.push({
              tab,
              source: entry.source,
              level: consoleLevel(entry.level),
              text: `${entry.text}${entry.url ? ` (${redactUrl(entry.url)})` : ''}`.slice(0, 2000),
            });
            if (this.#console.length > MAX_BUFFER) this.#console.shift();
          },
        );
        await cdp.send('Log.enable');
      })
      .catch(() => {});
    page.on('dialog', (dialog) => {
      this.#dialogs.set(page, dialog);
      for (const listener of [...this.#dialogListeners]) listener(page, dialog);
    });
    // Listening intercepts the page's file chooser (the native one would open on the
    // browser's own display, where nobody sees it); browser_file_upload answers it.
    page.on('filechooser', (chooser) => {
      this.#choosers.set(page, chooser);
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
        resourceType: response.request().resourceType(),
      });
      if (this.#network.length > MAX_BUFFER) this.#network.shift();
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.#dialogs.delete(page);
      this.#choosers.delete(page);
    });
    page.on('close', () => {
      this.#dialogs.delete(page);
      this.#choosers.delete(page);
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
        this.#downloads.push({
          fileName,
          savedAs: '(larger than 50 MB, not kept)',
          at: Date.now(),
        });
        return;
      }
      const savedAs = this.#onDownload
        ? await this.#onDownload(fileName, await readFile(file))
        : '(not kept)';
      this.#downloads.push({ fileName, savedAs, at: Date.now() });
      this.#event(`Downloaded file ${fileName} to "${savedAs}"`);
    } catch (error) {
      const savedAs = `(failed: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'})`;
      this.#downloads.push({ fileName, savedAs, at: Date.now() });
      this.#event(`Download of ${fileName} failed ${savedAs}`);
    } finally {
      if (this.#downloads.length > 100) this.#downloads.shift();
      await download.delete().catch(() => {});
    }
  }

  #event(text: string): void {
    this.#events.push(text);
    if (this.#events.length > 20) this.#events.shift();
  }

  // An action a page answers with a dialog (confirm, alert, a leave-page prompt) does not
  // finish until the dialog is answered — which the agent can only do once the tool returns.
  // So a tool returns as soon as a dialog opens, saying so (the answer's "Modal state"); the
  // action finishes in the background once browser_handle_dialog answers it.
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
      return `The page opened a ${first.dialog.type()} dialog and waits for an answer (browser_handle_dialog).`;
    } finally {
      off();
    }
  }

  // Nothing but the dialog can be done on a page that shows one.
  #assertNoDialog(): void {
    const dialog = this.#dialogs.get(this.#page);
    if (dialog) {
      throw new Error(
        `A ${dialog.type()} dialog is open: "${dialog.message().slice(0, 200)}". Answer it with browser_handle_dialog first.`,
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

  async applyDomainPolicy(policy: DomainPolicy): Promise<void> {
    const json = JSON.stringify(policy);
    if (json === this.#policyJson) return;
    this.#policyJson = null;
    if (this.#routeHandler) {
      await this.#context.unroute('**/*', this.#routeHandler);
      this.#routeHandler = null;
    }
    if (
      policy.allowLocalAddresses &&
      policy.domainBlocklist.length === 0 &&
      policy.domainAllowlist.length === 0
    ) {
      this.#policyJson = json;
      return;
    }
    this.#routeHandler = async (route) => {
      let url: URL;
      try {
        url = new URL(route.request().url());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
      let current = policy;
      if (url.hostname === '127.0.0.1' && this.#getPreviewOrigins) {
        // The owner may have started a preview since the last agent action.
        const previewOrigins = await this.#getPreviewOrigins().catch(() => []);
        current = { ...policy, previewOrigins };
      }
      if (await requestAllowed(current, url.href)) return route.continue();
      return route.abort('blockedbyclient');
    };
    await this.#context.route('**/*', this.#routeHandler);
    this.#policyJson = json;
  }

  #openPages(): Page[] {
    return this.#context.pages().filter((page) => !page.isClosed());
  }

  // A tab's title, or none while it shows a dialog (reading it would wait for the answer).
  async #title(page: Page): Promise<string> {
    if (this.#dialogs.has(page)) return '';
    return Promise.race([page.title().catch(() => ''), sleep(2_000).then(() => '')]);
  }

  async #tabLines(pages: Page[], agentId?: number): Promise<string[]> {
    return Promise.all(
      pages.map(async (page, index) => {
        const title = (await this.#title(page)).slice(0, 120);
        const current = page === this.#page ? ' (current)' : '';
        const yours =
          agentId !== undefined && this.#tabOwners.get(page) === agentId ? ' (yours)' : '';
        return `- ${index}:${current} [${title}](${redactUrl(page.url())})${yours}`;
      }),
    );
  }

  // What waits for an answer on the tab in front, worded as Playwright MCP's modal states.
  #modalLines(): string[] {
    const lines: string[] = [];
    const dialog = this.#dialogs.get(this.#page);
    if (dialog) {
      lines.push(
        `- ["${dialog.type()}" dialog with message "${dialog.message().slice(0, 300)}"]: can be handled by browser_handle_dialog`,
      );
    }
    if (this.#choosers.has(this.#page)) {
      lines.push('- [File chooser]: can be handled by browser_file_upload');
    }
    return lines;
  }

  // Every page tool's answer, in Playwright MCP's sections: what was done, the tabs (when
  // there are several), the page in front, what waits on it, and what happened meanwhile.
  async #answer(result: string | string[], extra: string[] = []): Promise<string> {
    const sections: string[] = [];
    const results = (Array.isArray(result) ? result : [result]).filter(Boolean);
    if (results.length) sections.push('### Result', ...results.map((line) => `- ${line}`));
    const pages = this.#openPages();
    if (pages.length > 1) sections.push('### Open tabs', ...(await this.#tabLines(pages)));
    sections.push('### Page', `- Page URL: ${redactUrl(this.#page.url())}`);
    const title = await this.#title(this.#page);
    if (title) sections.push(`- Page Title: ${title.slice(0, 200)}`);
    const modal = this.#modalLines();
    if (modal.length) sections.push('### Modal state', ...modal);
    sections.push(...extra);
    if (this.#events.length) {
      sections.push('### Events', ...this.#events.splice(0).map((event) => `- ${event}`));
    }
    return sections.join('\n');
  }

  async #settle(): Promise<void> {
    await this.#page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
    await this.#page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  }

  // Runs an action and waits for what it set off (Playwright MCP's waitForCompletion): a
  // navigation it started until the page loaded, else the requests it made until answered,
  // at most 5 s, with a short settle time after.
  async #waitForCompletion<T>(action: () => Promise<T>): Promise<T> {
    const page = this.#page;
    const requests: Request[] = [];
    const listener = (request: Request) => requests.push(request);
    page.on('request', listener);
    let result: T;
    try {
      result = await action();
      await sleep(SETTLE_MS);
    } finally {
      page.off('request', listener);
    }
    if (requests.some((request) => request.isNavigationRequest())) {
      await page
        .mainFrame()
        .waitForLoadState('load', { timeout: 10_000 })
        .catch(() => {});
      return result;
    }
    const answered = requests.map((request) =>
      request
        .response()
        .then((response) =>
          ['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(request.resourceType())
            ? response?.finished()
            : undefined,
        )
        .catch(() => {}),
    );
    await Promise.race([Promise.all(answered), sleep(5_000)]);
    if (requests.length) await sleep(SETTLE_MS);
    return result;
  }

  async navigate(url: string): Promise<string> {
    this.#assertNoDialog();
    const done = await this.#orDialog(
      (async () => {
        await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
        await this.#settle();
        return `Navigated to ${redactUrl(url)}`;
      })(),
    );
    return this.#answer(done);
  }

  async back(): Promise<string> {
    this.#assertNoDialog();
    const response = await this.#page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: LOAD_TIMEOUT_MS,
    });
    if (response === null && this.#page.url() === 'about:blank')
      return this.#answer('There is no page to go back to.');
    await this.#settle();
    return this.#answer('Went back');
  }

  async reload(): Promise<string> {
    this.#assertNoDialog();
    await this.#page.reload({ waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    await this.#settle();
    return this.#answer('Reloaded');
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

  // The accessibility snapshot of the tab (or of one element), credential values removed.
  async #ariaSnapshot(options: { target?: string; depth?: number } = {}): Promise<string> {
    const aria = {
      mode: 'ai' as const,
      timeout: 15_000,
      ...(options.depth && options.depth > 0 ? { depth: Math.floor(options.depth) } : {}),
    };
    const text = options.target
      ? await (await this.#resolveOne(options.target)).ariaSnapshot(aria)
      : await this.#page.ariaSnapshot(aria);
    return redactValues(text, await this.#credentialValues());
  }

  async snapshot(options: { target?: string; depth?: number } = {}): Promise<string> {
    this.#assertNoDialog();
    const clean = await this.#ariaSnapshot(options);
    return this.#answer('', ['### Snapshot', '```yaml', truncateSnapshot(clean), '```']);
  }

  // Lines of the snapshot that contain `text`, with two lines around each, for a page whose
  // snapshot is too long to read whole.
  async find(text: string): Promise<string> {
    this.#assertNoDialog();
    const needle = text.trim().toLowerCase();
    if (!needle) throw new Error('text is required.');
    const lines = (await this.#ariaSnapshot()).split('\n');
    const hits = lines
      .map((line, index) => (line.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
    if (hits.length === 0) return this.#answer(`No match for "${text.slice(0, 100)}"`);
    const shown = hits.slice(0, 30);
    const blocks: string[] = [];
    let lastEnd = -1;
    for (const hit of shown) {
      const from = Math.max(0, hit - 2, lastEnd + 1);
      const to = Math.min(lines.length - 1, hit + 2);
      if (from > to) continue;
      if (blocks.length && from > lastEnd + 1) blocks.push('…');
      blocks.push(...lines.slice(from, to + 1));
      lastEnd = to;
    }
    const count = `${hits.length} match(es) for "${text.slice(0, 100)}"${hits.length > shown.length ? `, the first ${shown.length} shown` : ''}`;
    return this.#answer(count, [
      '### Matches',
      '```yaml',
      truncateSnapshot(blocks.join('\n')),
      '```',
    ]);
  }

  #locatorFor(target: string): Locator {
    if (!isValidRef(target)) {
      throw new Error(`Unknown ref: ${target}. Use a ref from browser_snapshot (e.g. "e5").`);
    }
    return this.#page.locator(refSelector(target));
  }

  async #resolveOne(target: string): Promise<Locator> {
    const locator = this.#locatorFor(target);
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
      throw new Error(
        `Ref ${target} not found in the current page snapshot. Try capturing new snapshot.`,
      );
    }
    return locator.first();
  }

  // A locator or an element handle (browser_task acts on handles): both scroll and measure alike.
  async #humanMoveTo(
    locator: Pick<Locator, 'scrollIntoViewIfNeeded' | 'boundingBox'>,
  ): Promise<void> {
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

  async #assertNotCredential(locator: Locator, target: string): Promise<void> {
    if (isCredentialField(await this.#fieldAttributes(locator))) {
      throw new Error(
        `${target} is a password/2FA field — use browser_login / browser_login_code instead.`,
      );
    }
  }

  async click(target: string, options: ClickOptions = {}): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(target);
    await this.#humanMoveTo(locator);
    const done = await this.#orDialog(
      this.#waitForCompletion(async () => {
        await locator.click({
          button: options.button ?? 'left',
          clickCount: options.doubleClick ? 2 : 1,
          ...(options.modifiers?.length ? { modifiers: options.modifiers } : {}),
          timeout: ACTION_TIMEOUT_MS,
        });
        return `${options.doubleClick ? 'Double-clicked' : 'Clicked'} ${target}`;
      }),
    );
    return this.#answer(done);
  }

  // Types into a field after emptying it (Playwright MCP's browser_type replaces the value),
  // with real key events, never a DOM value set.
  async #fillText(locator: Locator, target: string, text: string): Promise<void> {
    await this.#assertNotCredential(locator, target);
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#clearField();
    await this.#typeHumanLike(text);
  }

  async type(target: string, text: string, submit?: boolean): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(target);
    await this.#fillText(locator, target, text);
    if (!submit) return this.#answer(`Typed into ${target}`);
    const done = await this.#orDialog(
      this.#waitForCompletion(async () => {
        await this.#page.keyboard.press('Enter');
        return `Typed into ${target} and pressed Enter`;
      }),
    );
    return this.#answer(done);
  }

  async fillForm(fields: FormField[]): Promise<string> {
    this.#assertNoDialog();
    const done: string[] = [];
    await this.#waitForCompletion(async () => {
      for (const field of fields) {
        const locator = await this.#resolveOne(field.target);
        const label = `${field.name.slice(0, 80)} (${field.target})`;
        if (field.type === 'textbox') {
          await this.#fillText(locator, field.target, field.value);
        } else if (field.type === 'slider') {
          await this.#assertNotCredential(locator, field.target);
          await locator.fill(field.value, { timeout: ACTION_TIMEOUT_MS });
        } else if (field.type === 'checkbox' || field.type === 'radio') {
          await this.#humanMoveTo(locator);
          await locator.setChecked(field.value === 'true', { timeout: ACTION_TIMEOUT_MS });
        } else if (field.type === 'combobox') {
          await this.#humanMoveTo(locator);
          await locator
            .selectOption({ label: field.value }, { timeout: ACTION_TIMEOUT_MS })
            .catch(() => locator.selectOption(field.value, { timeout: ACTION_TIMEOUT_MS }));
        } else {
          throw new Error(`Unknown field type for ${label}.`);
        }
        done.push(`Filled ${label}`);
      }
    });
    return this.#answer(done);
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
  // DOM value set: a field must start empty whatever was typed into it before.
  async #clearField(): Promise<void> {
    await this.#page.keyboard.press('Control+A');
    await this.#page.keyboard.press('Backspace');
  }

  async select(target: string, values: string[]): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(target);
    const chosen = await this.#waitForCompletion(() =>
      locator.selectOption(values, { timeout: ACTION_TIMEOUT_MS }),
    );
    return this.#answer(`Selected ${chosen.join(', ')} in ${target}`);
  }

  async hover(target: string): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(target);
    await this.#humanMoveTo(locator);
    await locator.hover({ timeout: ACTION_TIMEOUT_MS });
    return this.#answer(`Hovering ${target}`);
  }

  async drag(startTarget: string, endTarget: string): Promise<string> {
    this.#assertNoDialog();
    const from = await this.#resolveOne(startTarget);
    const to = await this.#resolveOne(endTarget);
    await this.#humanMoveTo(from);
    await this.#waitForCompletion(() => from.dragTo(to, { timeout: ACTION_TIMEOUT_MS }));
    return this.#answer(`Dragged ${startTarget} to ${endTarget}`);
  }

  async press(key: string): Promise<string> {
    this.#assertNoDialog();
    const done = await this.#orDialog(
      this.#waitForCompletion(async () => {
        await this.#page.keyboard.press(key);
        return `Pressed ${key}`;
      }),
    );
    return this.#answer(done);
  }

  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    target?: string,
  ): Promise<string> {
    this.#assertNoDialog();
    const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const element = target ? await this.#resolveOne(target) : null;
    if (element) {
      await this.#humanMoveTo(element);
      const box = await element.boundingBox().catch(() => null);
      if (box) await this.#page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    const steps = 4;
    const perStep = (Math.max(1, Math.min(10, amount)) * 120) / steps;
    await this.#waitForCompletion(async () => {
      for (let i = 0; i < steps; i++) {
        // A wheel turn over the element scrolls whatever the page scrolls there, the way a
        // person's wheel does; no script moves the page.
        await this.#page.mouse.wheel(dx * perStep, dy * perStep);
        await sleep(this.#humanInput ? 40 + Math.round(this.#random() * 40) : 0);
      }
    });
    return this.#answer(`Scrolled ${direction}`);
  }

  async waitFor(options: { time?: number; text?: string; textGone?: string }): Promise<string> {
    this.#assertNoDialog();
    const done: string[] = [];
    const timeout = MAX_WAIT_SEC * 1000;
    if (options.time !== undefined) {
      const seconds = Math.min(Math.max(options.time, 0), MAX_WAIT_SEC);
      await sleep(seconds * 1000);
      done.push(`Waited ${seconds} s`);
    }
    if (options.textGone) {
      await this.#page.getByText(options.textGone).first().waitFor({ state: 'hidden', timeout });
      done.push(`"${options.textGone.slice(0, 100)}" is gone`);
    }
    if (options.text) {
      await this.#page.getByText(options.text).first().waitFor({ state: 'visible', timeout });
      done.push(`"${options.text.slice(0, 100)}" is shown`);
    }
    if (done.length === 0) throw new Error('Give time, text or textGone.');
    return this.#answer(done);
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

  async screenshot(options: { target?: string; fullPage?: boolean } = {}): Promise<ToolOutput> {
    this.#assertNoDialog();
    const rects = await this.#coverRects();
    let png: Buffer;
    // Where the picture's origin lies, in the viewport coordinates of the rectangles.
    let offset = { x: 0, y: 0 };
    if (options.target) {
      const locator = await this.#resolveOne(options.target);
      const box = await locator.boundingBox().catch(() => null);
      if (box) offset = { x: box.x, y: box.y };
      png = await locator.screenshot({ type: 'png', scale: 'css', timeout: ACTION_TIMEOUT_MS });
    } else if (options.fullPage) {
      const scroll = await this.#page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      offset = { x: -scroll.x, y: -scroll.y };
      png = await this.#page.screenshot({
        type: 'png',
        scale: 'css',
        fullPage: true,
        timeout: ACTION_TIMEOUT_MS,
      });
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
    const what = options.target
      ? options.target
      : options.fullPage
        ? 'the full page'
        : 'the viewport';
    return {
      text: await this.#answer(
        `Took a screenshot of ${what}${rects.length ? ` (${rects.length} login field(s) covered)` : ''}`,
      ),
      image: { data: covered.toString('base64'), mimeType: 'image/png' },
    };
  }

  async tabs(
    action: 'list' | 'new' | 'close' | 'select',
    options: { url?: string; index?: number; agentId?: number } = {},
  ): Promise<string> {
    const pages = this.#openPages();
    if (action === 'list') {
      return ['### Open tabs', ...(await this.#tabLines(pages, options.agentId))].join('\n');
    }
    if (action === 'new') {
      const page = await this.#context.newPage();
      this.#wire(page);
      if (options.agentId !== undefined) this.#tabOwners.set(page, options.agentId);
      this.#page = page;
      if (options.url) {
        await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
        await this.#settle();
      }
      return this.#answer(`Opened tab ${this.#openPages().indexOf(page)}`);
    }
    const index = options.index ?? (action === 'close' ? pages.indexOf(this.#page) : undefined);
    if (index === undefined) throw new Error('index is required to select a tab.');
    const target = pages[index];
    if (!target) throw new Error(`Tab ${index} not found. Call browser_tabs with action "list".`);
    if (action === 'select') {
      this.#page = target;
      await target.bringToFront();
      return this.#answer(`Selected tab ${index}`);
    }
    if (action === 'close') {
      if (pages.length === 1) throw new Error('The last tab stays open.');
      await target.close();
      if (target === this.#page) {
        const remaining = this.#openPages();
        this.#page = remaining[remaining.length - 1]!;
        await this.#page.bringToFront().catch(() => {});
      }
      return this.#answer(`Closed tab ${index}`);
    }
    throw new Error(`Unknown tabs action: ${action}`);
  }

  // Design §4: the tabs an agent opened close when it gives control back. The last tab of
  // the browser always stays.
  async closeTabsOf(agentId: number): Promise<void> {
    for (const [page, owner] of [...this.#tabOwners]) {
      if (owner !== agentId || page.isClosed()) continue;
      if (this.#openPages().length <= 1) break;
      await page.close().catch(() => {});
    }
  }

  async dialogAction(accept: boolean, promptText?: string): Promise<string> {
    const dialog = this.#dialogs.get(this.#page);
    if (!dialog) throw new Error('No dialog visible');
    this.#dialogs.delete(this.#page);
    try {
      await (accept ? dialog.accept(promptText) : dialog.dismiss());
    } catch {
      return this.#answer('The dialog was already answered (from the live view, most likely).');
    }
    // What the dialog held up (a navigation, a request) goes on now.
    await sleep(SETTLE_MS);
    await this.#page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    return this.#answer(
      `${accept ? 'Accepted' : 'Dismissed'} the dialog "${dialog.message().slice(0, 200)}"`,
    );
  }

  async upload(files: UploadFile[], target?: string): Promise<string> {
    this.#assertNoDialog();
    const total = files.reduce((sum, file) => sum + file.buffer.length, 0);
    if (total > MAX_TRANSFER_BYTES) throw new Error('The files are larger than 50 MB together.');
    const payloads = files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      buffer: file.buffer,
    }));
    const names = files.map((file) => file.name).join(', ');
    if (target) {
      if (files.length === 0) throw new Error('paths is required when a target is given.');
      const locator = await this.#resolveOne(target);
      const fileInput = await locator.evaluate(
        (element) => element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'file',
      );
      await this.#waitForCompletion(async () => {
        if (fileInput) {
          await locator.setInputFiles(payloads, { timeout: ACTION_TIMEOUT_MS });
          return;
        }
        const opened = this.#page.waitForEvent('filechooser', { timeout: ACTION_TIMEOUT_MS });
        await this.#humanMoveTo(locator);
        await locator.click({ timeout: ACTION_TIMEOUT_MS });
        const chooser = await opened;
        this.#choosers.delete(this.#page);
        await chooser.setFiles(payloads);
      });
      return this.#answer(`Uploaded ${names} to ${target}`);
    }
    const chooser = this.#choosers.get(this.#page);
    if (!chooser) {
      throw new Error(
        'No file chooser visible. Click the upload button first, or give it as target.',
      );
    }
    this.#choosers.delete(this.#page);
    await this.#waitForCompletion(() => chooser.setFiles(payloads));
    return this.#answer(files.length ? `Uploaded ${names}` : 'Cancelled the file chooser');
  }

  async downloads(): Promise<string> {
    if (this.#downloads.length === 0) return '### Result\n- No downloads yet';
    return [
      '### Downloads',
      ...this.#downloads.map((entry) => `- ${entry.fileName} -> ${entry.savedAs}`),
    ].join('\n');
  }

  async console(level: ConsoleLevel): Promise<string> {
    const threshold = CONSOLE_RANK[level] ?? CONSOLE_RANK.info;
    const entries = this.#console
      .filter((entry) => CONSOLE_RANK[entry.level] <= threshold)
      .slice(-100);
    if (entries.length === 0) return '### Result\n- No console messages';
    return [
      '### Console messages',
      ...entries.map(
        (entry) =>
          `- [${entry.level.toUpperCase()}] ${entry.text} (${entry.source}, tab ${entry.tab})`,
      ),
    ].join('\n');
  }

  async network(options: { includeStatic: boolean; filter?: string }): Promise<string> {
    const needle = options.filter?.trim().toLowerCase();
    const entries = this.#network
      .filter(
        (entry) =>
          options.includeStatic || entry.status >= 400 || !STATIC_TYPES.has(entry.resourceType),
      )
      .filter((entry) => !needle || entry.url.toLowerCase().includes(needle))
      .slice(-100);
    if (entries.length === 0) return '### Result\n- No network requests';
    return [
      '### Network requests',
      ...entries.map(
        (entry, index) =>
          `${index + 1}. [${entry.method}] ${entry.url} => [${entry.status}] (${entry.resourceType}, tab ${entry.tab})`,
      ),
    ].join('\n');
  }

  async #remember(handle: ElementHandle | null): Promise<void> {
    if (!handle) return;
    this.#filled.push(handle);
    if (this.#filled.length > 16)
      await this.#filled
        .shift()
        ?.dispose()
        .catch(() => {});
  }

  async submitsForm(call: {
    tool: string;
    target?: string;
    key?: string;
    submit?: boolean;
  }): Promise<{ submits: boolean; formAction: string | null; groundedElement: string | null }> {
    const none = { submits: false, formAction: null, groundedElement: null };
    try {
      if (call.tool === 'browser_press_key') {
        if (call.key !== 'Enter') return none;
        return await this.#page.evaluate(() => {
          const element = document.activeElement as HTMLInputElement | null;
          const form = element?.form ?? null;
          const field = element?.tagName === 'INPUT';
          return {
            submits: !!form && field,
            formAction: form ? form.action : null,
            groundedElement: null,
          };
        });
      }
      if (!call.target || !isValidRef(call.target)) return none;
      if (call.tool === 'browser_type' && !call.submit) return none;
      const locator = this.#page.locator(refSelector(call.target)).first();
      if ((await locator.count()) === 0) return none;
      return await locator.evaluate((element, typing) => {
        const control = element as HTMLButtonElement | HTMLInputElement;
        const form = control.form ?? element.closest('form');
        const type = (control.getAttribute('type') ?? '').toLowerCase();
        const buttonValue =
          element.tagName === 'INPUT' && ['button', 'submit', 'reset', 'image'].includes(type)
            ? control.value
            : null;
        const groundedElement = typing
          ? null
          : [
              element.textContent,
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              buttonValue,
            ]
              .filter(Boolean)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 300) || null;
        if (!form) return { submits: false, formAction: null, groundedElement };
        if (typing)
          return { submits: element.tagName === 'INPUT', formAction: form.action, groundedElement };
        const submits =
          (element.tagName === 'BUTTON' && (type === '' || type === 'submit')) ||
          (element.tagName === 'INPUT' && (type === 'submit' || type === 'image'));
        return { submits, formAction: submits ? form.action : null, groundedElement };
      }, call.tool === 'browser_type');
    } catch {
      return none;
    }
  }

  pagePath(): string | null {
    try {
      return new URL(this.#page.url()).pathname;
    } catch {
      return null;
    }
  }

  pageOrigin(): string | null {
    try {
      const origin = new URL(this.#page.url()).origin;
      return origin === 'null' ? null : origin;
    } catch {
      return null;
    }
  }

  async #originOf(locator: Locator): Promise<string> {
    return locator.evaluate(() => location.origin);
  }

  async frameOrigin(target: string): Promise<string> {
    return this.#originOf(await this.#resolveOne(target));
  }

  async fillLogin(
    usernameTarget: string,
    passwordTarget: string,
    username: string,
    password: string,
    origin: string,
  ): Promise<string> {
    this.#assertNoDialog();
    const usernameLocator = await this.#resolveOne(usernameTarget);
    const passwordLocator = await this.#resolveOne(passwordTarget);
    const passwordField = await this.#fieldAttributes(passwordLocator);
    const isPasswordInput =
      passwordField.tag === 'input' &&
      ((passwordField.type ?? '').toLowerCase() === 'password' ||
        (passwordField.autocomplete ?? '').toLowerCase().includes('password'));
    if (!isPasswordInput) {
      throw new Error(
        `${passwordTarget} is not a password field; the password is typed only into one.`,
      );
    }
    if (isCredentialField(await this.#fieldAttributes(usernameLocator))) {
      throw new Error(`${usernameTarget} is a password field, not the username field.`);
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

  async fillCode(target: string, code: string): Promise<string> {
    this.#assertNoDialog();
    const locator = await this.#resolveOne(target);
    const field = await this.#fieldAttributes(locator);
    if (field.tag !== 'input' && field.tag !== 'textarea') {
      throw new Error(`${target} is not a text field.`);
    }
    await this.#humanMoveTo(locator);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await this.#clearField();
    await this.#remember(await locator.elementHandle({ timeout: ACTION_TIMEOUT_MS }));
    await this.#typeHumanLike(code);
    return 'Code filled.';
  }

  // ---------------------------------------------------------------------------------------------
  // browser_task (task/loop.ts): the fast path observes with task/page-script.ts in the isolated
  // world of each frame and acts through element handles of the nodes it listed. Every input goes
  // through the same human-like pointer and typing as the step tools, waits for what it set off,
  // and returns as soon as a page dialog opens.

  // The frames of the last observation, in the order their elements were numbered.
  #taskFrames: Frame[] = [];

  async #withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #observeTask(): Promise<PageObservation> {
    const page = this.#page;
    const dialog = this.#dialogs.get(page);
    const empty = {
      scrollY: 0,
      pageHeight: 0,
      viewportHeight: 0,
      textLength: 0,
      elements: 0,
    };
    if (dialog) {
      // Nothing can be read while a dialog blocks the page's scripts.
      return {
        url: redactUrl(page.url()),
        title: '',
        text: '',
        dialogs: [],
        metrics: empty,
        elements: [],
        omitted: 0,
        keys: [],
        jsDialog: this.guard.redact(`${dialog.type()}: ${dialog.message().slice(0, 300)}`),
      };
    }
    const frames = page
      .frames()
      .filter((frame) => !frame.isDetached())
      .slice(0, 12);
    const secrets = await this.#credentialValues();
    const clean = (value: string | undefined) =>
      value === undefined ? undefined : this.guard.redact(redactValues(value, secrets));
    const raws: (RawFrameObservation | null)[] = [];
    for (const [index, frame] of frames.entries()) {
      raws.push(
        await this.#withTimeout(
          frame.evaluate(OBSERVE, { textLimit: 2500, maxElements: 400, main: index === 0 }),
          10_000,
          'Reading the page',
        ).catch((error: unknown) => {
          if (index === 0) throw error;
          return null;
        }),
      );
    }
    const main = raws[0];
    if (!main) throw new Error('The page is still loading.');
    const elements: PageElement[] = [];
    let omitted = 0;
    this.#taskFrames = [];
    for (const [index, raw] of raws.entries()) {
      if (!raw) continue;
      const frameIndex = this.#taskFrames.push(frames[index]!) - 1;
      omitted += raw.omitted;
      for (const element of raw.elements) {
        elements.push({
          ...element,
          label: clean(element.label),
          text: clean(element.text),
          placeholder: clean(element.placeholder),
          value: clean(element.value),
          near: clean(element.near),
          options: element.options?.map((option) => clean(option) ?? option),
          i: elements.length + 1,
          frame: frameIndex,
          id: element.id,
        });
      }
    }
    return {
      url: redactUrl(main.url),
      title: this.guard.redact(main.title.slice(0, 200)),
      text: clean(main.text) ?? '',
      dialogs: main.dialogs.map((text) => clean(text) ?? ''),
      metrics: { ...main.metrics, elements: elements.length },
      elements,
      omitted,
      keys: raws.filter((raw) => raw !== null).map((raw) => raw!.key),
      repeated: repeatedLabels(elements),
      jsDialog: null,
    };
  }

  async #taskKeys(): Promise<string[] | null> {
    const keys: string[] = [];
    for (const frame of this.#taskFrames) {
      if (frame.isDetached()) return null;
      const key = await this.#withTimeout(
        frame.evaluate(PAGE_KEY),
        5_000,
        'Checking the page',
      ).catch(() => null);
      if (key === null) return null;
      keys.push(key);
    }
    return keys;
  }

  async #taskFresh(observation: PageObservation, element: PageElement | null): Promise<boolean> {
    if (this.#dialogs.has(this.#page)) return false;
    const keys = await this.#taskKeys();
    if (!keys || keys.join('\u0001') !== observation.keys.join('\u0001')) return false;
    if (!element) return true;
    const frame = this.#taskFrames[element.frame];
    if (!frame) return false;
    return (await frame.evaluate(GUARD, element.id).catch(() => null)) !== null;
  }

  async #taskHandle(element: PageElement): Promise<{ frame: Frame; handle: ElementHandle }> {
    const frame = this.#taskFrames[element.frame];
    if (!frame || frame.isDetached())
      throw new TaskActError('gone', 'The frame of the element is gone.');
    const handle = (await frame.evaluateHandle(NODE, element.id).catch(() => null))?.asElement();
    if (!handle) throw new TaskActError('gone', 'The element is no longer on the page.');
    return { frame, handle };
  }

  // Scrolls the element into view and checks it takes the input at its centre (jev-ultrafast's
  // occlusion guard): a covered element is not clicked through the cover.
  async #taskReach(element: PageElement): Promise<ElementHandle> {
    const { frame, handle } = await this.#taskHandle(element);
    await handle.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
    const hit = await frame
      .evaluate(HIT, element.id)
      .catch(() => ({ ok: false as const, why: 'gone' }));
    if (!hit.ok) {
      const code = (['covered', 'hidden', 'gone', 'disabled', 'offscreen'] as const).find(
        (candidate) => candidate === hit.why,
      );
      throw new TaskActError(code ?? 'failed', `The element is ${hit.why}.`);
    }
    await this.#humanMoveTo(handle);
    return handle;
  }

  async #taskClick(handle: ElementHandle): Promise<void> {
    const page = this.#page;
    // A link that opens a new tab (target=_blank): the task goes on there, and the live view
    // shows it, as a person would see it come to the front.
    const opened: Page[] = [];
    const onPage = (candidate: Page) => void opened.push(candidate);
    this.#context.on('page', onPage);
    let done: string;
    try {
      done = await this.#orDialog(
        this.#waitForCompletion(async () => {
          await handle.click({ timeout: ACTION_TIMEOUT_MS });
          return 'clicked';
        }),
      );
    } finally {
      this.#context.off('page', onPage);
    }
    if (done !== 'clicked' && this.#dialogs.has(page)) {
      throw new TaskActError('dialog', done);
    }
    let tab: Page | null = null;
    for (const candidate of opened) {
      if (!candidate.isClosed() && (await candidate.opener().catch(() => null)) === page) {
        tab = candidate;
      }
    }
    if (tab) {
      this.#page = tab;
      await tab.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
      await tab.bringToFront().catch(() => {});
      await this.#settle();
    }
  }

  async #taskAct(input: TaskActInput): Promise<void> {
    this.#assertNoDialog();
    const { element } = input;
    switch (input.operation) {
      case 'SCROLL_DOWN':
      case 'SCROLL_UP': {
        const dy = input.operation === 'SCROLL_DOWN' ? 1 : -1;
        await this.#waitForCompletion(async () => {
          for (let i = 0; i < 4; i++) {
            await this.#page.mouse.wheel(0, dy * 140);
            await sleep(this.#humanInput ? 40 + Math.round(this.#random() * 40) : 0);
          }
        });
        return;
      }
      case 'WAIT':
        await sleep(600);
        return;
      case 'CLICK': {
        if (!element) throw new TaskActError('failed', 'No element to click.');
        await this.#taskClick(await this.#taskReach(element));
        return;
      }
      case 'TYPE_TEXT': {
        if (!element || input.text === undefined)
          throw new TaskActError('failed', 'Nothing to type.');
        const handle = await this.#taskReach(element);
        const attributes = await handle.evaluate((node) => {
          const field = node as Element;
          return {
            tag: field.tagName.toLowerCase(),
            type: field.getAttribute('type'),
            autocomplete: field.getAttribute('autocomplete'),
            name: field.getAttribute('name'),
          };
        });
        if (element.credential || isCredentialField(attributes)) {
          throw new TaskActError(
            'refused',
            `${element.label ?? 'This field'} is a password or code field: use browser_login / browser_login_code.`,
          );
        }
        await handle.click({ timeout: ACTION_TIMEOUT_MS });
        await this.#clearField();
        await this.#typeHumanLike(input.text);
        await sleep(this.#humanInput ? 120 : 30);
        return;
      }
      case 'PRESS_ENTER': {
        if (!element) throw new TaskActError('failed', 'No field to press Enter in.');
        const handle = await this.#taskReach(element);
        await handle.focus().catch(() => {});
        const page = this.#page;
        const done = await this.#orDialog(
          this.#waitForCompletion(async () => {
            await page.keyboard.press('Enter');
            return 'pressed';
          }),
        );
        if (done !== 'pressed' && this.#dialogs.has(page)) throw new TaskActError('dialog', done);
        return;
      }
      case 'SELECT': {
        if (!element || !input.option) throw new TaskActError('failed', 'No option to select.');
        const handle = await this.#taskReach(element);
        await this.#waitForCompletion(() =>
          handle
            .selectOption({ label: input.option! }, { timeout: ACTION_TIMEOUT_MS })
            .catch(() => handle.selectOption(input.option!, { timeout: ACTION_TIMEOUT_MS })),
        );
        return;
      }
      default:
        throw new TaskActError('failed', `Operation ${input.operation} is not an action.`);
    }
  }

  taskPage(): TaskPage {
    // The owner watches the task in the live view, which shows the tab in front.
    void this.#page.bringToFront().catch(() => {});
    return {
      observe: () => this.#observeTask(),
      fresh: (observation, element) => this.#taskFresh(observation, element),
      act: (input) => this.#taskAct(input),
    };
  }

  async agentSnapshot(limit: number): Promise<string> {
    if (this.#dialogs.has(this.#page)) return '';
    const text = await this.#ariaSnapshot().catch(() => '');
    return this.guard.redact(truncateSnapshot(text, limit));
  }
}
