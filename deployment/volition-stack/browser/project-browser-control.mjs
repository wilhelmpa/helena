// Controls the project browsers over the Chrome DevTools Protocol. The project display
// has no window manager, so nothing sizes Chromium's windows: the window keeper fits them
// to the page size the live view asks for, and to the screen otherwise, which changes size
// with the desktop view's panel. It also draws every tab of a live view's window at the
// view's pixel ratio. The control routes serve the tab list and the navigation the Plan
// toolbar uses.

const TARGET_ID = /^[A-Fa-f0-9]{16,64}$/;
const MAX_BODY = 8 * 1024;
const CDP_TIMEOUT_MS = 5_000;

export class BrowserControlError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// What the address field accepts: a web address, or text without a scheme that is read
// as one. Anything else a page could run or read locally (javascript:, file:, chrome:)
// is refused.
export function navigableUrl(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text || text.length > 4096) throw new BrowserControlError(400, "Enter an address");
  if (text === "about:blank") return text;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new BrowserControlError(400, "Enter an address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserControlError(400, "Only http and https addresses can be opened");
  }
  return url.toString();
}

export function targetId(value) {
  if (typeof value !== "string" || !TARGET_ID.test(value)) {
    throw new BrowserControlError(400, "Unknown tab");
  }
  return value;
}

// How far a window may differ from its screen and still count as filling it. Without a
// window manager Chromium sets a window one pixel smaller than it was asked to.
const FIT_TOLERANCE = 2;

// The bounds a window needs to have the given size, or null when it already has it.
export function fittedBounds(bounds, size) {
  if (!size.width || !size.height) return null;
  const fitted = { left: 0, top: 0, width: size.width, height: size.height };
  const fits =
    bounds.windowState === "normal" &&
    bounds.left === fitted.left &&
    bounds.top === fitted.top &&
    Math.abs(bounds.width - fitted.width) <= FIT_TOLERANCE &&
    Math.abs(bounds.height - fitted.height) <= FIT_TOLERANCE;
  return fits ? null : fitted;
}

// The window size that shows a live view's page: the page in window pixels, which is its CSS
// size times the device pixel ratio the live view emulates, plus the browser's own tab strip
// and toolbar. Without a live view a window fills the screen.
export function windowSize(screen, chrome, live) {
  if (!live) return screen;
  return {
    width: Math.round(live.width * live.ratio) + chrome.width,
    height: Math.round(live.height * live.ratio) + chrome.height,
  };
}

// One DevTools websocket, with the commands in flight matched to their answers and the
// events passed to onEvent.
export class CdpConnection {
  static open(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("DevTools connection timed out"));
      }, CDP_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("DevTools connection failed"));
      });
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onEvent = null;
    this.onClose = null;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.method) return this.onEvent?.(message);
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message || "DevTools error"));
      else waiting.resolve(message.result ?? {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const waiting of this.pending.values()) waiting.reject(new Error("DevTools closed"));
      this.pending.clear();
      this.onClose?.();
    });
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("DevTools closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("DevTools command timed out"));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function devtoolsJson(port, path, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
  });
  if (!response.ok) throw new BrowserControlError(502, "The browser did not answer");
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// A new DevTools connection to the whole browser, not to one page.
export async function openBrowser(port) {
  const version = await devtoolsJson(port, "/json/version");
  return CdpConnection.open(version.webSocketDebuggerUrl);
}

// One DevTools connection per project browser, kept open and shared by the window keeper
// and the tab list, with a session attached to each page it has asked something.
//
// A pixel ratio emulation belongs to the session that set it: a clear from any session ends
// it, and so does the setting session's end. So only this connection emulates, and it is the
// last one to close.
//
// While a live view is watched every page is emulated, ratio 1 included, and the emulation is
// changed, never cleared: Chromium 153 keeps the size a page's window had when an emulation
// began, and an explicit clear after the window changed size meanwhile gives the page that old
// size back, wider or taller than its window (measured on the bench: a 3839 pixel wide page in
// a 1280 pixel window), until the window changes size again. The live view then showed that
// page, and after a router restart the window keeper could no longer read the toolbar from it,
// so the live view stayed on JPEG. A session that ends does not do this; only the clear does.
export class BrowserLink {
  constructor(port) {
    this.port = port;
    this.connection = null;
    this.opening = null;
    this.sessions = new Map();
    // The pixel ratio this link has itself set each page to, null once it ended the
    // emulation, and 0 while the page is pinned. A page this link has never touched may
    // still be emulated by another DevTools client, so only an explicit entry here, not its
    // absence, says the page is already known to be at that ratio.
    this.ratios = new Map();
    // The tab strip and toolbar of the window last fitted, in window pixels.
    this.chrome = null;
    // fitWindows runs one at a time per browser: the keeper's pass and a live view's resize
    // would otherwise pin and emulate the same pages in between each other.
    this.queue = Promise.resolve();
  }

  // Callers that arrive while the connection is being opened share that one.
  async open() {
    if (this.connection && !this.connection.closed) return this.connection;
    this.opening ??= openBrowser(this.port)
      .then((connection) => {
        this.connection = connection;
        this.sessions.clear();
        this.ratios.clear();
        return connection;
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  // Runs work after the work queued before it, whether that succeeded or not.
  serial(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  async send(targetId, method, params) {
    const connection = await this.open();
    let sessionId = this.sessions.get(targetId);
    if (!sessionId) {
      ({ sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true }));
      this.sessions.set(targetId, sessionId);
    }
    return connection.send(method, params, sessionId);
  }

  async evaluate(targetId, expression, awaitPromise = false) {
    const { result } = await this.send(targetId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    return result?.value;
  }

  // Draws a page at a pixel ratio, with the CSS size of its window divided by the ratio, or
  // with ratio null ends this link's emulation of it. Runs the CDP call the first time this
  // link touches a page, in case another client left it emulated — an absent entry is not
  // read as "already there". Returns whether it ended an emulation, after which the page's
  // window has to change size once for the page to take the window's size (see the class).
  async emulate(targetId, ratio) {
    if (this.ratios.get(targetId) === ratio) return false;
    if (ratio === null) await this.send(targetId, "Emulation.clearDeviceMetricsOverride", {});
    else {
      await this.send(targetId, "Emulation.setDeviceMetricsOverride", {
        width: 0,
        height: 0,
        deviceScaleFactor: ratio,
        scale: ratio,
        mobile: false,
      });
    }
    this.ratios.set(targetId, ratio);
    return ratio === null;
  }

  // Holds a page at a CSS size while its window changes, so its layout changes once. A page
  // pinned at ratio 2 is drawn at half size in its window's corner until emulate() lets it
  // follow the window again, so fitWindows unpins it as soon as the window has its size.
  async pin(targetId, { width, height, ratio }) {
    await this.send(targetId, "Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: ratio,
      mobile: false,
    });
    this.ratios.set(targetId, 0);
  }

  // Forgets the sessions of pages that are gone.
  keep(targetIds) {
    for (const id of this.sessions.keys()) if (!targetIds.has(id)) this.sessions.delete(id);
    for (const id of this.ratios.keys()) if (!targetIds.has(id)) this.ratios.delete(id);
  }

  close() {
    this.connection?.close();
    this.connection = null;
  }
}

const links = new Map();
// The page size each browser's live view asked for, by DevTools port: CSS pixels and the
// window pixels per CSS pixel.
const liveViewports = new Map();

function linkFor(port) {
  let link = links.get(port);
  if (!link) {
    link = new BrowserLink(port);
    links.set(port, link);
  }
  return link;
}

// The title browser-harness puts in front of the tab the agent works in.
const AGENT_TAB_MARKER = "\u{1F434}";

// The browser's tabs. The one in front is the one whose page is visible: DevTools lists
// the tabs in no order that says which one the person is looking at.
export async function listTabs(port) {
  const targets = await devtoolsJson(port, "/json/list");
  const pages = (Array.isArray(targets) ? targets : []).filter((target) => target.type === "page");
  const link = linkFor(port);
  const visibility = await Promise.all(
    pages.map((page) => link.evaluate(page.id, "document.visibilityState").catch(() => null)),
  );
  const front = Math.max(0, visibility.indexOf("visible"));
  return pages.map((page, index) => ({
    id: page.id,
    title: page.title || page.url,
    url: page.url,
    active: index === front,
    agent: page.title.startsWith(AGENT_TAB_MARKER),
  }));
}

// Brings a tab to the front of its window.
export async function activateTab(port, id) {
  await devtoolsJson(port, `/json/activate/${targetId(id)}`);
}

async function onPage(port, id, work) {
  const tab = (await devtoolsJson(port, "/json/list")).find?.((target) => target.id === id);
  if (!tab?.webSocketDebuggerUrl) throw new BrowserControlError(404, "Unknown tab");
  const page = await CdpConnection.open(tab.webSocketDebuggerUrl);
  try {
    return await work(page);
  } finally {
    page.close();
  }
}

async function stepHistory(page, delta) {
  const history = await page.send("Page.getNavigationHistory");
  const entry = history.entries?.[history.currentIndex + delta];
  if (entry) await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
}

// The toolbar's actions. Each names the tab it acts on; the tab list says which one is
// in front.
export async function controlBrowser(port, action, body) {
  switch (action) {
    case "navigate": {
      const url = navigableUrl(body.url);
      await onPage(port, targetId(body.id), (page) => page.send("Page.navigate", { url }));
      return { ok: true };
    }
    case "back":
    case "forward":
      await onPage(port, targetId(body.id), (page) =>
        stepHistory(page, action === "back" ? -1 : 1),
      );
      return { ok: true };
    case "reload":
      await onPage(port, targetId(body.id), (page) => page.send("Page.reload"));
      return { ok: true };
    case "activate":
      await activateTab(port, body.id);
      return { ok: true };
    case "close":
      await devtoolsJson(port, `/json/close/${targetId(body.id)}`);
      return { ok: true };
    case "new": {
      const url = body.url ? navigableUrl(body.url) : "about:blank";
      const tab = await devtoolsJson(port, `/json/new?${encodeURIComponent(url)}`, "PUT");
      return { ok: true, id: tab?.id ?? null };
    }
    default:
      throw new BrowserControlError(404, "Unknown action");
  }
}

export async function readJsonBody(request) {
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new BrowserControlError(415, "JSON required");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BrowserControlError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new BrowserControlError(400, "Invalid JSON");
  }
}

// Sets the page size of a browser's live view ({width, height, ratio}), or clears it with
// null so the windows fill the screen again, and fits the windows at once. Resolves once the
// page has its new size and has drawn it, so a live view's video can start on the new page.
export async function setLiveViewport(port, viewport) {
  if (viewport) liveViewports.set(port, viewport);
  else liveViewports.delete(port);
  await fitWindows(linkFor(port));
}

// The tab strip and toolbar above the page, in window pixels, as the window keeper last
// measured them: the page starts this far below the window's top left corner.
export function windowChrome(port) {
  return links.get(port)?.chrome ?? null;
}

// The sizes a visible tab reports: its screen, its window, its page and the page's pixel
// ratio. A tab behind another keeps the sizes it had when it was last shown.
const MAX_CHROME = 400;
const WINDOW_SIZES = `[document.visibilityState, screen.width, screen.height, outerWidth, outerHeight,
  innerWidth, innerHeight, devicePixelRatio]`;
// Answers once the page has drawn twice, or after a tenth of a second in a tab that draws
// nothing (a tab behind another does not).
const DRAWN = `new Promise((resolve) => {
  setTimeout(resolve, 100);
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}).then(() => true)`;
// How long a window may take to get the size it was given before its page is let go anyway.
const RESIZE_WAIT_MS = 1_000;
const RESIZE_POLL_MS = 15;

// What a tab's sizes say: whether it is the one shown, its screen, its window's tab strip and
// toolbar in window pixels, its pixel ratio (page zoom included), and whether the page's own
// size agrees with its window. It does not while a page is pinned to a CSS size, or once an emulation cleared after
// its window changed size left the page at the old size (see BrowserLink): its toolbar then
// comes out negative or larger than any toolbar.
export function readWindowSizes(value) {
  if (!Array.isArray(value) || value.length < 8 || !value.slice(1).every(Number.isFinite)) return null;
  const [visibility, screenWidth, screenHeight, outerWidth, outerHeight, innerWidth, innerHeight, ratio] = value;
  const chrome = {
    width: Math.round(outerWidth - innerWidth * ratio),
    height: Math.round(outerHeight - innerHeight * ratio),
  };
  return {
    visible: visibility === "visible",
    screen: { width: screenWidth, height: screenHeight },
    outer: { width: outerWidth, height: outerHeight },
    chrome,
    ratio,
    consistent: chrome.width >= 0 && chrome.height >= 0 && chrome.width < MAX_CHROME && chrome.height < MAX_CHROME,
  };
}

// Changes a window's height by one pixel and back, which gives its pages their window's size
// again after a cleared emulation left them at an old one.
async function nudge(connection, windowId, bounds) {
  const { left, top, width, height } = bounds;
  await connection.send("Browser.setWindowBounds", { windowId, bounds: { left, top, width, height: height + 1 } });
  await connection.send("Browser.setWindowBounds", { windowId, bounds: { left, top, width, height } });
}

// A window's visible tab's sizes once they pass a check, which a new window size or a nudge
// needs a moment for: the display applies it a moment after Chromium asks for it. The last
// sizes read when the wait runs out.
async function sizesOnceSettled(link, tab, settled) {
  const deadline = Date.now() + RESIZE_WAIT_MS;
  for (;;) {
    const sizes = readWindowSizes(await link.evaluate(tab, WINDOW_SIZES).catch(() => null));
    if (!sizes || settled(sizes) || Date.now() >= deadline) return sizes;
    await new Promise((resolve) => setTimeout(resolve, RESIZE_POLL_MS));
  }
}

function hasSize(sizes, bounds) {
  const { width, height } = sizes.outer;
  return Math.abs(width - bounds.width) <= FIT_TOLERANCE && Math.abs(height - bounds.height) <= FIT_TOLERANCE;
}

// Fits every window of one browser to its live view or its screen. The visible tab of a
// window is asked for the sizes, because the display is not reachable from here and a tab
// behind another one keeps the sizes it had when it was last shown. A window without a
// visible tab, such as a minimized one, is restored and fitted on the next pass.
//
// A new window size with an unchanged ratio just resizes the window: the emulated page follows
// it and lays out once. With a new ratio the page is pinned at its new CSS size first, so it
// does not lay out at the new ratio for the old window and then again, and is let go the
// moment the window has its size. A page that disagrees with its window is given the window's
// size again (see readWindowSizes).
export function fitWindows(link) {
  return link.serial(() => fitWindowsNow(link));
}

async function fitWindowsNow(link) {
  const connection = await link.open();
  const { targetInfos = [] } = await connection.send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");
  link.keep(new Set(pages.map((target) => target.targetId)));
  const live = liveViewports.get(link.port);
  const ratio = live ? live.ratio : null;
  const windows = new Map();
  for (const target of pages) {
    const { windowId, bounds } = await connection.send("Browser.getWindowForTarget", {
      targetId: target.targetId,
    });
    const entry = windows.get(windowId) ?? { bounds, sizes: null, shown: null, tabs: [] };
    windows.set(windowId, entry);
    entry.tabs.push(target.targetId);
    if (entry.sizes) continue;
    const sizes = readWindowSizes(await link.evaluate(target.targetId, WINDOW_SIZES));
    if (sizes?.visible) {
      entry.sizes = sizes;
      entry.shown = target.targetId;
    }
  }
  for (const [windowId, { bounds, shown, tabs, sizes: measured }] of windows) {
    let sizes = measured;
    if (bounds.windowState !== "normal") {
      await connection.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
    }
    if (sizes && link.ratios.get(shown) !== 0) {
      if (!sizes.consistent) {
        await nudge(connection, windowId, bounds);
        sizes = await sizesOnceSettled(link, shown, (next) => next.consistent);
      }
      if (sizes?.consistent) link.chrome = sizes.chrome;
    }
    const chrome = link.chrome;
    const fitted = sizes && chrome ? fittedBounds(bounds, windowSize(sizes.screen, chrome, live)) : null;
    const newRatio = tabs.some((tab) => link.ratios.get(tab) !== ratio);
    if (fitted) {
      if (live && newRatio) for (const tab of tabs) await link.pin(tab, live);
      await connection.send("Browser.setWindowBounds", { windowId, bounds: fitted });
      if (live && shown) await sizesOnceSettled(link, shown, (next) => hasSize(next, fitted));
    }
    let cleared = false;
    for (const tab of tabs) if (await link.emulate(tab, ratio)) cleared = true;
    if (cleared) await nudge(connection, windowId, fitted ?? bounds);
    if (live && shown && (fitted || newRatio)) await link.evaluate(shown, DRAWN, true).catch(() => {});
  }
}

// Runs fitWindows for every project browser once per interval. A browser that cannot be
// reached is tried again on the next pass with a new connection.
export function startWindowKeeper({ listBrowsers, intervalMs = 1_000, log = () => {} }) {
  const lastErrors = new Map();
  let stopped = false;
  let running = false;

  async function pass() {
    if (running || stopped) return;
    running = true;
    try {
      const current = await listBrowsers();
      const ports = new Set(current.map((browser) => browser.cdpPort));
      for (const [port, link] of links) {
        if (!ports.has(port)) {
          link.close();
          links.delete(port);
          liveViewports.delete(port);
        }
      }
      for (const { cdpPort } of current) {
        const link = linkFor(cdpPort);
        try {
          await fitWindows(link);
          lastErrors.delete(cdpPort);
        } catch (error) {
          // A browser that stays down is reported once, not on every pass.
          if (error.message !== lastErrors.get(cdpPort)) {
            log(`browser on port ${cdpPort}: ${error.message}`);
          }
          lastErrors.set(cdpPort, error.message);
          link.close();
        }
      }
    } catch (error) {
      log(`window keeper: ${error.message}`);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(pass, intervalMs);
  void pass();
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const link of links.values()) link.close();
  };
}
