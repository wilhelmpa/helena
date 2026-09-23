// Controls the project browsers over the Chrome DevTools Protocol. The project display
// has no window manager, so nothing sizes Chromium's windows to the screen: the window
// keeper does, whenever the screen changes size with the panel it is shown in. The
// control routes serve the tab list and the navigation the Plan toolbar uses.

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

// The bounds a window needs to fill its screen, or null when it already does.
export function fittedBounds(bounds, screen) {
  if (!screen.width || !screen.height) return null;
  const fitted = { left: 0, top: 0, width: screen.width, height: screen.height };
  const fits =
    bounds.windowState === "normal" &&
    bounds.left === fitted.left &&
    bounds.top === fitted.top &&
    Math.abs(bounds.width - fitted.width) <= FIT_TOLERANCE &&
    Math.abs(bounds.height - fitted.height) <= FIT_TOLERANCE;
  return fits ? null : fitted;
}

// One DevTools websocket, with the commands in flight matched to their answers.
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
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
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

// The browser's tabs, most recently used first, as DevTools lists them.
export async function listTabs(port) {
  const targets = await devtoolsJson(port, "/json/list");
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => target.type === "page")
    .map((target, index) => ({
      id: target.id,
      title: target.title || target.url,
      url: target.url,
      active: index === 0,
    }));
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
      await devtoolsJson(port, `/json/activate/${targetId(body.id)}`);
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

// Fits every window of one browser to its screen. The page is asked for the screen size
// because the display is not reachable from here; a tab that shows nothing yet reports
// it all the same.
export async function fitWindows(connection, sessions) {
  const { targetInfos = [] } = await connection.send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");
  const live = new Set(pages.map((target) => target.targetId));
  for (const id of sessions.keys()) if (!live.has(id)) sessions.delete(id);
  const fittedWindows = new Set();
  for (const target of pages) {
    const { windowId, bounds } = await connection.send("Browser.getWindowForTarget", {
      targetId: target.targetId,
    });
    if (fittedWindows.has(windowId)) continue;
    fittedWindows.add(windowId);
    let sessionId = sessions.get(target.targetId);
    if (!sessionId) {
      ({ sessionId } = await connection.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      }));
      sessions.set(target.targetId, sessionId);
    }
    const { result } = await connection.send(
      "Runtime.evaluate",
      { expression: "[screen.width, screen.height]", returnByValue: true },
      sessionId,
    );
    const [width, height] = Array.isArray(result?.value) ? result.value : [];
    const fitted = fittedBounds(bounds, { width, height });
    if (!fitted) continue;
    if (bounds.windowState !== "normal") {
      await connection.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
    }
    await connection.send("Browser.setWindowBounds", { windowId, bounds: fitted });
  }
}

// Runs fitWindows for every project browser once per interval. A browser that cannot be
// reached is tried again on the next pass with a new connection.
export function startWindowKeeper({ listBrowsers, intervalMs = 1_000, log = () => {} }) {
  const browsers = new Map();
  let stopped = false;
  let running = false;

  async function pass() {
    if (running || stopped) return;
    running = true;
    try {
      const current = await listBrowsers();
      const ports = new Set(current.map((browser) => browser.cdpPort));
      for (const [port, state] of browsers) {
        if (!ports.has(port)) {
          state.connection?.close();
          browsers.delete(port);
        }
      }
      for (const { cdpPort } of current) {
        const state = browsers.get(cdpPort) ?? {
          connection: null,
          sessions: new Map(),
          lastError: null,
        };
        browsers.set(cdpPort, state);
        try {
          if (!state.connection || state.connection.closed) {
            const version = await devtoolsJson(cdpPort, "/json/version");
            state.connection = await CdpConnection.open(version.webSocketDebuggerUrl);
            state.sessions.clear();
          }
          await fitWindows(state.connection, state.sessions);
          state.lastError = null;
        } catch (error) {
          // A browser that stays down is reported once, not on every pass.
          if (error.message !== state.lastError) log(`browser on port ${cdpPort}: ${error.message}`);
          state.lastError = error.message;
          state.connection?.close();
          state.connection = null;
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
    for (const state of browsers.values()) state.connection?.close();
  };
}
