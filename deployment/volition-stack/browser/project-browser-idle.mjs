import { CdpConnection } from "./project-browser-control.mjs";

const IDLE_MS = 120_000;
const CHECK_MS = 10_000;

export async function setPageLifecycle(port, state) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Project browser did not answer");
  const pages = (await response.json()).filter(
    (target) => target.type === "page" && /^https?:\/\//.test(target.url) && target.webSocketDebuggerUrl,
  );
  const results = await Promise.allSettled(
    pages.map(async (target) => {
      const connection = await CdpConnection.open(target.webSocketDebuggerUrl);
      try {
        await connection.send("Page.setWebLifecycleState", { state });
      } finally {
        connection.close();
      }
    }),
  );
  const changed = results.filter((result) => result.status === "fulfilled").length;
  if (pages.length && !changed) throw new Error("Could not change project browser page state");
  return changed;
}

export class BrowserIdle {
  constructor({ listBrowsers, lifecycle = setPageLifecycle, now = Date.now, idleMs = IDLE_MS, log = () => {} }) {
    this.listBrowsers = listBrowsers;
    this.lifecycle = lifecycle;
    this.now = now;
    this.idleMs = idleMs;
    this.log = log;
    this.browsers = new Map();
    this.timer = null;
  }

  record(slug, port = null) {
    let browser = this.browsers.get(slug);
    if (!browser) {
      browser = { port, viewers: 0, locked: false, lastActive: this.now(), lastFreeze: 0, frozen: null, queue: Promise.resolve() };
      this.browsers.set(slug, browser);
    } else if (port !== null && port !== browser.port) {
      browser.port = port;
      browser.frozen = null;
      browser.lastActive = this.now();
    }
    return browser;
  }

  transition(browser) {
    browser.queue = browser.queue.then(async () => {
      if (browser.port === null) return;
      const idle = browser.viewers === 0 && !browser.locked && this.now() - browser.lastActive >= this.idleMs;
      if (idle && (!browser.frozen || this.now() - browser.lastFreeze >= 60_000)) {
        const count = await this.lifecycle(browser.port, "frozen");
        browser.frozen = count > 0;
        browser.lastFreeze = this.now();
      } else if (!idle && browser.frozen) {
        await this.lifecycle(browser.port, "active");
        browser.frozen = false;
      }
    }).catch((error) => this.log(`browser idle: ${error.message}`));
    return browser.queue;
  }

  async poll() {
    const found = await this.listBrowsers();
    const wanted = new Set(found.map((browser) => browser.slug));
    for (const browser of found) await this.transition(this.record(browser.slug, browser.cdpPort));
    for (const slug of this.browsers.keys()) if (!wanted.has(slug)) this.browsers.delete(slug);
  }

  start() {
    void this.poll().catch((error) => this.log(`browser idle: ${error.message}`));
    this.timer = setInterval(() => {
      void this.poll().catch((error) => this.log(`browser idle: ${error.message}`));
    }, CHECK_MS);
  }

  wake(slug) {
    const browser = this.record(slug);
    // A restarted router cannot know whether Chromium is still frozen. A first
    // wake must send "active" even when this process has never frozen it.
    if (browser.frozen === null) browser.frozen = true;
    browser.lastActive = this.now();
    return this.transition(browser);
  }

  view(slug, port, socket) {
    const browser = this.record(slug, port);
    browser.viewers += 1;
    socket.once("close", () => {
      browser.viewers = Math.max(0, browser.viewers - 1);
      browser.lastActive = this.now();
    });
    // After a router restart the page state is unknown; transition() activates it.
    // The stream must attach only after the page is active. Chromium can accept a
    // screencast started while frozen without ever sending its first frame.
    return this.wake(slug);
  }

  lock(slug, holder) {
    const browser = this.record(slug);
    browser.locked = Boolean(holder);
    if (holder) void this.wake(slug);
    else browser.lastActive = this.now();
  }

  async stop() {
    clearInterval(this.timer);
    const waking = [];
    for (const [slug, browser] of this.browsers) {
      browser.locked = true;
      waking.push(this.wake(slug));
    }
    await Promise.all(waking);
  }
}
