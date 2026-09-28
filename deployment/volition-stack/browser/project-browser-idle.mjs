import { CdpConnection, releasePageVisibility, restorePageVisibility } from "./project-browser-control.mjs";

const IDLE_MS = 120_000;
const CHECK_MS = 10_000;

export async function setPageLifecycle(port, state) {
  if (state === "frozen") await releasePageVisibility(port);
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
  if (changed !== pages.length) throw new Error("Could not change every project browser page state");
  if (state === "active") await restorePageVisibility(port);
  return changed;
}

// Who uses a project browser (live viewers, the gateway's control lock, the last action) and
// what follows from it: pages are frozen after IDLE_MS without use and woken on the next use.
// With `power` (project-browser-power.mjs) the browser also runs only on demand: a use starts
// it (wake, view, lock), `stopAfter(slug)` ms without use stop it (Infinity: "immer an", which
// the poll also starts), and nothing here touches a browser that does not run. Without
// `power` every browser is taken to run, as before.
export class BrowserIdle {
  constructor({
    listBrowsers,
    lifecycle = setPageLifecycle,
    releaseVisibility = releasePageVisibility,
    now = Date.now,
    idleMs = IDLE_MS,
    power = null,
    stopAfter = () => Infinity,
    log = () => {},
  }) {
    this.listBrowsers = listBrowsers;
    this.lifecycle = lifecycle;
    this.releaseVisibility = releaseVisibility;
    this.now = now;
    this.idleMs = idleMs;
    this.power = power;
    this.stopAfter = stopAfter;
    this.log = log;
    this.browsers = new Map();
    this.timer = null;
  }

  record(slug, port = null) {
    let browser = this.browsers.get(slug);
    if (!browser) {
      browser = { slug, port, viewers: 0, locked: false, lastActive: this.now(), lastFreeze: 0, frozen: null, queue: Promise.resolve() };
      this.browsers.set(slug, browser);
    } else if (port !== null && port !== browser.port) {
      browser.port = port;
      browser.frozen = null;
      browser.lastActive = this.now();
    }
    return browser;
  }

  // Whether nobody watches or holds the browser.
  unused(browser) {
    return browser.viewers === 0 && !browser.locked;
  }

  // Whether the browser is to be stopped now: unused for its stop time.
  due(browser) {
    return this.unused(browser) && this.now() - browser.lastActive >= this.stopAfter(browser.slug);
  }

  // One step towards what the browser's use asks for. `start`: a use that needs the browser
  // running (a viewer, a toolbar action, an agent); the poll passes false and never starts a
  // browser, except one kept running ("immer an").
  transition(browser, start = false) {
    browser.queue = browser.queue.then(async () => {
      if (browser.port === null) return true;
      if (this.power) {
        const keep = this.stopAfter(browser.slug) === Infinity;
        if (!start && !keep && this.due(browser)) {
          if (this.power.state(browser.slug) !== "stopped") {
            await this.power.stop(browser.slug, () => this.due(browser));
            browser.frozen = null;
          }
          return true;
        }
        if (!this.power.running(browser.slug)) {
          if (!start && !keep) return true;
          await this.power.ensure(browser.slug, browser.port);
          // A browser just started has its pages active; a restarted router cannot know.
          browser.frozen = null;
          if (start) browser.frozen = true;
        }
      }
      const idle = this.unused(browser) && this.now() - browser.lastActive >= this.idleMs;
      if (idle && (!browser.frozen || this.now() - browser.lastFreeze >= 60_000)) {
        const count = await this.lifecycle(browser.port, "frozen");
        browser.frozen = count > 0;
        browser.lastFreeze = this.now();
      } else if (!idle && browser.frozen) {
        await this.lifecycle(browser.port, "active");
        browser.frozen = false;
      }
      return true;
    }).catch((error) => {
      this.log(`browser idle: ${error.message}`);
      return false;
    });
    return browser.queue;
  }

  async poll() {
    const found = await this.listBrowsers();
    const wanted = new Set(found.map((browser) => browser.slug));
    for (const { slug, cdpPort } of found) {
      const browser = this.record(slug, cdpPort);
      if (this.power) await this.power.observe(slug, cdpPort);
      await this.transition(browser);
    }
    for (const slug of this.browsers.keys()) {
      if (wanted.has(slug)) continue;
      this.browsers.delete(slug);
      this.power?.forget(slug);
    }
  }

  start() {
    void this.poll().catch((error) => this.log(`browser idle: ${error.message}`));
    this.timer = setInterval(() => {
      void this.poll().catch((error) => this.log(`browser idle: ${error.message}`));
    }, CHECK_MS);
  }

  // A use of the browser: starts it when it does not run and wakes its pages. Resolves to
  // whether it is ready (false: it did not start, or its pages could not be woken).
  wake(slug, { force = false } = {}) {
    const browser = this.record(slug);
    // A restarted router cannot know whether Chromium is still frozen. A first
    // wake must send "active" even when this process has never frozen it.
    if (force || browser.frozen === null) browser.frozen = true;
    browser.lastActive = this.now();
    return this.transition(browser, true);
  }

  // Whether the browser runs (always true without `power`).
  running(slug) {
    return !this.power || this.power.running(slug);
  }

  view(slug, port, socket) {
    const browser = this.record(slug, port);
    browser.viewers += 1;
    socket.once("close", () => {
      browser.viewers = Math.max(0, browser.viewers - 1);
      browser.lastActive = this.now();
      this.releaseWhenUnused(browser);
    });
    // After a router restart the page state is unknown; transition() activates it.
    // The stream must attach only after the page is active. Chromium can accept a
    // screencast started while frozen without ever sending its first frame.
    return this.wake(slug);
  }

  releaseWhenUnused(browser) {
    browser.queue = browser.queue.then(async () => {
      if (!browser.viewers && !browser.locked && this.running(browser.slug)) {
        browser.frozen = null;
        await this.releaseVisibility(browser.port);
      }
    }).catch((error) => this.log(`browser visibility: ${error.message}`));
  }

  lock(slug, holder) {
    const browser = this.record(slug);
    browser.locked = Boolean(holder);
    if (holder) void this.wake(slug);
    else {
      browser.lastActive = this.now();
      this.releaseWhenUnused(browser);
    }
  }

  // Router shutdown: leaves every running browser's pages active and visible, and starts or
  // stops none (the browsers outlive the router).
  async stop() {
    clearInterval(this.timer);
    const waking = [];
    for (const browser of this.browsers.values()) {
      browser.locked = true;
      if (!this.running(browser.slug)) continue;
      if (browser.frozen === null) browser.frozen = true;
      browser.lastActive = this.now();
      waking.push(this.transition(browser).finally(() => this.releaseVisibility(browser.port)));
    }
    await Promise.all(waking);
  }
}
