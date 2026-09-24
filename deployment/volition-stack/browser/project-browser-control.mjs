// Controls the project browsers over the Chrome DevTools Protocol. The project display
// has no window manager, so nothing sizes Chromium's windows: the window keeper fits them
// to the page size the live view asks for, and to the screen otherwise, which changes size
// with the desktop view's panel. The control routes serve the tab list and the navigation the
// Plan toolbar uses.
//
// Chromium runs at device scale factor 2 on the display (--force-device-scale-factor=2 in its
// unit): a page is drawn with two display pixels per CSS pixel, so a live view on a
// high-density screen gets frames one to one, and window sizes, the screen and CDP input are
// in CSS pixels (DIP) all the same. The keeper reads the factor from the window it measures
// (readWindowSizes), so a Chromium started without the flag is kept at factor 1, as before.
// The pages are not emulated, except while a page too small for the agent's screenshots at
// factor 2 is pinned to factor 1 (see BrowserLink.pin). The earlier emulation of ratio 2 with
// Emulation.setDeviceMetricsOverride's scale halved the position of every CDP mouse event
// (measured on the bench: a click at 400,300 reached the page at 200,150), the viewer's and
// the agent's alike.

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

// Chromium keeps a window at least this many DIP wide; a narrower page (a phone's view) is
// pinned at its width inside it, from the window's left edge (see fitWindows).
export const MIN_WINDOW_WIDTH = 500;

// The window size that shows a live view's page: its CSS size plus the browser's own tab strip
// and toolbar, all in DIP. Without a live view a window fills the screen.
export function windowSize(screen, chrome, live) {
  if (!live) return screen;
  return { width: Math.max(live.width, MIN_WINDOW_WIDTH) + chrome.width, height: live.height + chrome.height };
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
// An emulation belongs to the session that set it: a clear from any session ends it, and so
// does the setting session's end. So only this connection emulates, and it is the last one to
// close. Chromium 153 keeps the size a page's window had when an emulation began, and a clear
// after the window changed size meanwhile gives the page that old size back, wider or taller
// than its window (a 3839 pixel wide page in a 1280 pixel window on the bench), until the
// window changes size again; a session that ends does not do this. So every clear is followed
// by a nudge of the window (fitWindows).
export class BrowserLink {
  constructor(port) {
    this.port = port;
    this.connection = null;
    this.opening = null;
    this.sessions = new Map();
    // The emulation this link set on each page: null for none, or the CSS size it is pinned
    // to. A page this link has never touched may still be emulated by another DevTools client,
    // so only an explicit entry here, not its absence, says what the page is at.
    this.pins = new Map();
    // The tab strip and toolbar of the window last fitted, in DIP, and the display pixels
    // per DIP the browser draws at.
    this.chrome = null;
    this.scale = 1;
    // fitWindows runs one at a time per browser: the keeper's pass and a live view's resize
    // would otherwise pin and resize the same pages in between each other.
    this.queue = Promise.resolve();
  }

  // Callers that arrive while the connection is being opened share that one.
  async open() {
    if (this.connection && !this.connection.closed) return this.connection;
    this.opening ??= openBrowser(this.port)
      .then((connection) => {
        this.connection = connection;
        this.sessions.clear();
        this.pins.clear();
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

  // Holds a page at a CSS size and pixel ratio ({ width, height, ratio }), drawn from its
  // window's top left corner: at ratio 1 a page smaller than SHARP_MIN_EDGE
  // (project-browser-screencast.mjs) while an agent is in the browser, whose screenshots in
  // window pixels would otherwise put its clicks off by 2 (its window shows it scaled to the
  // browser's factor); at the browser's own factor a page narrower than a window can be.
  // Without scale, so CDP input stays in the page's CSS pixels. With size null it ends this
  // link's emulation. Runs the CDP call the first time this link touches a page, in case
  // another client left it emulated. Returns whether it ended an emulation, after which the
  // window has to change size once for the page to take the window's size again (see the
  // class).
  async pin(targetId, size) {
    const key = size ? `${size.width}x${size.height}@${size.ratio}` : null;
    if (this.pins.get(targetId) === key) return false;
    if (!size) await this.send(targetId, "Emulation.clearDeviceMetricsOverride", {});
    else {
      await this.send(targetId, "Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: size.ratio,
        mobile: false,
      });
    }
    this.pins.set(targetId, key);
    return !size;
  }

  pinned(targetId) {
    return typeof this.pins.get(targetId) === "string";
  }

  // Forgets the sessions of pages that are gone.
  keep(targetIds) {
    for (const id of this.sessions.keys()) if (!targetIds.has(id)) this.sessions.delete(id);
    for (const id of this.pins.keys()) if (!targetIds.has(id)) this.pins.delete(id);
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
// Browsers whose windows were asked to fill the screen (a desktop viewer, or the last live
// viewer gone), by DevTools port. Until a browser is in either map, the keeper leaves its
// windows' size alone for STARTUP_GRACE_MS after the router starts: a live view open when the
// router restarted reconnects within seconds, and filling the screen meanwhile would lay the
// page out twice.
const screenRequested = new Set();
const STARTUP_GRACE_MS = 15_000;
const startedAt = Date.now();

function linkFor(port) {
  let link = links.get(port);
  if (!link) {
    link = new BrowserLink(port);
    links.set(port, link);
  }
  return link;
}

// The title browser-harness puts in front of the tab the agent works in, while its session is
// attached to it (TAB_MARKER_JS in its daemon.py, removed when it lets go).
const AGENT_TAB_MARKER = "\u{1F434}";

export function isAgentTitle(title) {
  return typeof title === "string" && title.startsWith(AGENT_TAB_MARKER);
}

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
    agent: isAgentTitle(page.title),
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
      // A new tab opens Google unless it was given an address (owner, 2026-09-24).
      const url = body.url ? navigableUrl(body.url) : "https://www.google.com/";
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

// Sets the page size of a browser's live view ({width, height, pin1}: its CSS size, and
// whether the page is drawn at pixel ratio 1; see BrowserLink.pin), or clears it with null so
// the windows fill the screen again, and fits the windows at once. Resolves once the page has
// its new size and has drawn it, so a live view's video can start on the new page.
export async function setLiveViewport(port, viewport) {
  if (viewport) {
    liveViewports.set(port, viewport);
    screenRequested.delete(port);
  } else {
    liveViewports.delete(port);
    screenRequested.add(port);
  }
  await fitWindows(linkFor(port));
}

// The tab strip and toolbar above the page, in DIP, as the window keeper last measured them
// (the page starts this far below the window's top left corner), and the display pixels per
// DIP: { width, height, scale }.
export function windowChrome(port) {
  const link = links.get(port);
  return link?.chrome ? { ...link.chrome, scale: link.scale } : null;
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

// What a tab's sizes say: whether it is the one shown, its screen and window in DIP, its
// window's tab strip and toolbar in DIP, the display pixels per DIP the browser draws at, and
// whether the page's own size agrees with its window. The window is the page's width (the
// display has no window manager and no borders) and its height plus the toolbar, so of the
// factors 1 and 2 only the right one gives a toolbar as narrow as MAX_CHROME_WIDTH:
// devicePixelRatio is that factor times the page zoom, and innerWidth is the window's width
// divided by the zoom. A page pinned to a CSS size, or left at an old size by a cleared
// emulation (see BrowserLink), fits neither: its toolbar comes out negative or too large.
const MAX_CHROME_WIDTH = 24;
const SCALES = [1, 2];
export function readWindowSizes(value) {
  if (!Array.isArray(value) || value.length < 8 || !value.slice(1).every(Number.isFinite)) return null;
  const [visibility, screenWidth, screenHeight, outerWidth, outerHeight, innerWidth, innerHeight, ratio] = value;
  const toolbar = (scale) => ({
    width: Math.round(outerWidth - (innerWidth * ratio) / scale),
    height: Math.round(outerHeight - (innerHeight * ratio) / scale),
  });
  const plausible = ({ width, height }) => width >= 0 && width <= MAX_CHROME_WIDTH && height >= 0 && height < MAX_CHROME;
  const scale = SCALES.find((candidate) => plausible(toolbar(candidate)));
  return {
    visible: visibility === "visible",
    screen: { width: screenWidth, height: screenHeight },
    outer: { width: outerWidth, height: outerHeight },
    chrome: toolbar(scale ?? 1),
    scale: scale ?? 1,
    ratio,
    consistent: scale !== undefined,
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
// A new window size just resizes the window: the page follows it and lays out once. A page
// drawn at ratio 1 (live.pin1) is pinned at its new CSS size before its window changes, for the
// same reason. A page that disagrees with its window is given the window's size again (see
// readWindowSizes), and so is every page whose emulation ends.
export function fitWindows(link) {
  return link.serial(() => fitWindowsNow(link));
}

async function fitWindowsNow(link) {
  const connection = await link.open();
  const { targetInfos = [] } = await connection.send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");
  link.keep(new Set(pages.map((target) => target.targetId)));
  const live = liveViewports.get(link.port);
  // A page drawn at ratio 1 for the agent, or narrower than a window can be, is pinned.
  const pinned = live && (live.pin1 || live.width < MIN_WINDOW_WIDTH);
  const pin = pinned ? { width: live.width, height: live.height, ratio: live.pin1 ? 1 : link.scale } : null;
  const waiting = !live && !screenRequested.has(link.port) && Date.now() - startedAt < STARTUP_GRACE_MS;
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
    if (sizes && !link.pinned(shown)) {
      if (!sizes.consistent) {
        await nudge(connection, windowId, bounds);
        sizes = await sizesOnceSettled(link, shown, (next) => next.consistent);
      }
      if (sizes?.consistent) {
        link.chrome = sizes.chrome;
        link.scale = sizes.scale;
      }
    }
    // Just after a router restart, a window keeps its size for the live view to come back.
    if (waiting) continue;
    const chrome = link.chrome;
    const fitted = sizes && chrome ? fittedBounds(bounds, windowSize(sizes.screen, chrome, live)) : null;
    let changed = false;
    let cleared = false;
    const applyPins = async () => {
      for (const tab of tabs) {
        const before = link.pins.get(tab);
        if (await link.pin(tab, pin)) cleared = true;
        if (link.pins.get(tab) !== before) changed = true;
      }
    };
    // A page pinned for ratio 1 takes its new CSS size before its window changes.
    if (fitted && pin) await applyPins();
    if (fitted) {
      await connection.send("Browser.setWindowBounds", { windowId, bounds: fitted });
      if (live && shown) await sizesOnceSettled(link, shown, (next) => hasSize(next, fitted));
    }
    await applyPins();
    if (cleared) await nudge(connection, windowId, fitted ?? bounds);
    if (live && shown && (fitted || changed)) await link.evaluate(shown, DRAWN, true).catch(() => {});
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
          screenRequested.delete(port);
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
