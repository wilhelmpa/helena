import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createProjectBrowserRouter,
  isPrivateGatewayHeader,
  isSameOrigin,
  listProjectBrowsers,
  resolveProjectBrowser,
} from "./project-router.mjs";
import {
  BrowserLink,
  fittedBounds,
  fitWindows,
  navigableUrl,
  readWindowSizes,
  setLiveViewport,
  targetId,
  windowChrome,
  windowSize,
} from "./project-browser-control.mjs";
import { acceptWebSocket } from "./websocket.mjs";

let root;
let upstream;
let router;
// WebSocket connections, which closing a server does not end.
const upgraded = new Set();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-router-"));
});

afterEach(async () => {
  router?.closeAllConnections?.();
  upstream?.closeAllConnections?.();
  for (const socket of upgraded) socket.destroy();
  upgraded.clear();
  await Promise.all(
    [router, upstream].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await fs.rm(root, { recursive: true, force: true });
  router = null;
  upstream = null;
});

async function state(slug, port, cdpPort = 19200) {
  const directory = path.join(root, slug);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify({ schemaVersion: 1, slug, noVncPort: port, cdpPort }),
    { mode: 0o600 },
  );
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function until(check) {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check());
}

const PAGE = "A".repeat(32);
const BEHIND = "B".repeat(32);

// A browser window on a 1920x1080 screen with 87 pixels of tab strip and toolbar, showing
// the first of its tabs that is visible. A tab behind it reports the sizes it had when it
// was last shown. The browser records every DevTools command, answers a screencast with one
// frame, and sends the events a test emits to every connection.
//
// Its pages report their sizes as Chromium 153 does (measured on the bench): an emulation that
// follows the window (width and height 0) divides the window by its ratio, a pinned one keeps
// its CSS size, and an emulation cleared after the window changed size meanwhile leaves the
// page at the size it had when the emulation began, until the window changes size again.
const CHROME_HEIGHT = 87;
function fakeBrowser(tabs = [{ id: PAGE, visible: true }]) {
  const commands = [];
  const connections = new Set();
  let bounds = { left: 0, top: 0, width: 1920, height: 1080, windowState: "normal" };
  // The page's emulation: null, or { width, height, ratio } with width 0 following the window.
  let emulation = null;
  // The page size an emulation began at, whether the window changed size since, and the old
  // size a clear left the page at.
  let emulatedFrom = null;
  let resizedWhileEmulated = false;
  let stale = null;
  const windowPage = () => ({ width: bounds.width, height: bounds.height - CHROME_HEIGHT });
  const pageSizes = () => {
    if (emulation?.width) return { ...emulation };
    if (emulation) {
      const { width, height } = windowPage();
      return { width: width / emulation.ratio, height: height / emulation.ratio, ratio: emulation.ratio };
    }
    return { ...(stale ?? windowPage()), ratio: 1 };
  };
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/json/version") {
      const { port } = server.address();
      return response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }));
    }
    if (request.url === "/json/list") {
      const list = tabs.map(({ id }) => ({ id, type: "page", title: id, url: "https://a.test/" }));
      return response.end(JSON.stringify(list));
    }
    response.end("{}");
  });
  // lastInput is the time of the last trusted input the router's activity world reports.
  const browser = { server, commands, connections: 0, lastInput: 0 };
  // Leaves the page at an old size, as a clear after a resize does.
  browser.makeStale = (size) => {
    stale = size;
  };
  browser.page = pageSizes;
  server.on("upgrade", (request, socket, head) => {
    upgraded.add(socket);
    browser.connections++;
    const connection = acceptWebSocket(request, socket, head);
    connections.add(connection);
    connection.on("message", (data) => {
      const message = JSON.parse(data.toString());
      commands.push(message);
      const reply = (result = {}) => connection.send(JSON.stringify({ id: message.id, result }));
      switch (message.method) {
        case "Target.getTargets":
          return reply({ targetInfos: tabs.map(({ id }) => ({ targetId: id, type: "page" })) });
        case "Target.attachToTarget":
          return reply({ sessionId: `S-${message.params.targetId}` });
        case "Browser.getWindowForTarget":
          return reply({ windowId: 1, bounds });
        case "Browser.setWindowBounds": {
          const before = bounds;
          bounds = { ...bounds, ...message.params.bounds };
          if (before.width !== bounds.width || before.height !== bounds.height) {
            if (emulation) resizedWhileEmulated = true;
            else stale = null;
          }
          return reply();
        }
        case "Emulation.setDeviceMetricsOverride": {
          if (!emulation) {
            emulatedFrom = stale ?? windowPage();
            resizedWhileEmulated = false;
          }
          const { width, height, deviceScaleFactor } = message.params;
          emulation = { width, height, ratio: deviceScaleFactor };
          return reply();
        }
        case "Emulation.clearDeviceMetricsOverride":
          if (emulation && resizedWhileEmulated) stale = emulatedFrom;
          emulation = null;
          return reply();
        case "Page.getFrameTree":
          return reply({ frameTree: { frame: { id: PAGE } } });
        case "Page.createIsolatedWorld":
          return reply({ executionContextId: 5 });
        case "Runtime.evaluate": {
          if (message.params.contextId) return reply({ result: { value: browser.lastInput } });
          if (message.params.awaitPromise) return reply({ result: { value: true } });
          const tab = tabs.find(({ id }) => message.sessionId === `S-${id}`);
          const page = pageSizes();
          const visibility = tab.visible ? "visible" : "hidden";
          const sizes = [visibility, 1920, 1080, bounds.width, bounds.height, page.width, page.height, page.ratio];
          const visibilityOnly = message.params.expression === "document.visibilityState";
          return reply({ result: { value: visibilityOnly ? visibility : sizes } });
        }
        case "Page.startScreencast":
          reply();
          return connection.send(
            JSON.stringify({
              method: "Page.screencastFrame",
              sessionId: message.sessionId,
              params: {
                data: Buffer.from("jpeg").toString("base64"),
                metadata: { deviceWidth: 800, deviceHeight: 513 },
                sessionId: 7,
              },
            }),
          );
        default:
          return reply();
      }
    });
  });
  browser.sent = (method) => commands.filter((command) => command.method === method);
  browser.emit = (method, params) => {
    const event = JSON.stringify({ method, params, sessionId: `S-${PAGE}` });
    for (const connection of connections) connection.send(event);
  };
  return browser;
}

function upgradeStatus(port, path, headers) {
  return new Promise((resolve) => {
    const request = http.request({
      port,
      host: "127.0.0.1",
      path,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        ...headers,
      },
    });
    request.on("response", (response) => resolve(response.statusCode));
    request.on("error", () => resolve(null));
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.end();
  });
}

describe("project browser router", () => {
  it("classifies browser credentials as private for HTTP and WebSocket forwarding", () => {
    assert.equal(isPrivateGatewayHeader("Cookie"), true);
    assert.equal(isPrivateGatewayHeader("Authorization"), true);
    assert.equal(isPrivateGatewayHeader("Proxy-Authorization"), true);
  });

  it("routes only a registered project and strips its private prefix", async () => {
    let seen = "";
    let seenSecret;
    let seenAuthorization;
    let seenCookie;
    upstream = http.createServer((request, response) => {
      seen = request.url;
      seenSecret = request.headers["x-volition-secret"];
      seenAuthorization = request.headers.authorization;
      seenCookie = request.headers.cookie;
      response.end("browser");
    });
    const upstreamPort = await listen(upstream);
    await state("demo", upstreamPort);
    router = createProjectBrowserRouter({ root });
    const routerPort = await listen(router);

    const response = await fetch(`http://127.0.0.1:${routerPort}/projects/demo/vnc.html?resize=scale`, {
      headers: {
        authorization: "Bearer must-not-reach-browser",
        connection: "close",
        cookie: "better-auth.session_token=must-not-reach-browser",
        "x-volition-secret": "must-not-reach-browser",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "browser");
    assert.equal(seen, "/vnc.html?resize=scale");
    assert.equal(seenSecret, undefined);
    assert.equal(seenAuthorization, undefined);
    assert.equal(seenCookie, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const missing = await fetch(`http://127.0.0.1:${routerPort}/projects/other/vnc.html`, {
      headers: { connection: "close" },
    });
    assert.equal(missing.status, 404);
  });

  it("rejects traversal, symlinked state and out-of-range upstreams", async () => {
    await assert.rejects(resolveProjectBrowser(root, "/projects/../demo/vnc.html"));
    await state("demo", 80);
    await assert.rejects(resolveProjectBrowser(root, "/projects/demo/vnc.html"));
    await fs.rm(path.join(root, "demo/runtime.json"));
    await fs.writeFile(path.join(root, "foreign"), "{}", { mode: 0o600 });
    await fs.symlink(path.join(root, "foreign"), path.join(root, "demo/runtime.json"));
    await assert.rejects(resolveProjectBrowser(root, "/projects/demo/vnc.html"));
  });

  it("serves the tab list and toolbar actions from the project's DevTools endpoint", async () => {
    const seen = [];
    upstream = http.createServer((request, response) => {
      seen.push(`${request.method} ${request.url}`);
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/json/list") {
        response.end(
          JSON.stringify([
            { id: "A".repeat(32), type: "page", title: "Front", url: "https://a.test/" },
            { id: "B".repeat(32), type: "service_worker", title: "", url: "https://a.test/sw.js" },
            { id: "C".repeat(32), type: "page", title: "", url: "https://c.test/" },
          ]),
        );
      } else response.end("{}");
    });
    const cdpPort = await listen(upstream);
    await state("demo", 16000, cdpPort);
    router = createProjectBrowserRouter({ root });
    const base = `http://127.0.0.1:${await listen(router)}/projects/demo/api`;

    const tabs = await (await fetch(`${base}/tabs`)).json();
    assert.deepEqual(tabs, {
      tabs: [
        { id: "A".repeat(32), title: "Front", url: "https://a.test/", active: true, agent: false },
        { id: "C".repeat(32), title: "https://c.test/", url: "https://c.test/", active: false, agent: false },
      ],
    });

    const activated = await fetch(`${base}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "C".repeat(32) }),
    });
    assert.equal(activated.status, 200);
    assert.ok(seen.includes(`GET /json/activate/${"C".repeat(32)}`));

    // A form on another site cannot send JSON, so anything else is refused.
    const form = await fetch(`${base}/close`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `id=${"C".repeat(32)}`,
    });
    assert.equal(form.status, 415);
    const unknown = await fetch(`${base}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "../json/version" }),
    });
    assert.equal(unknown.status, 400);
    assert.equal((await fetch(`${base}/unknown`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  });

  it("streams the tab in front to the live view and sends the viewer's input to it", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    await state("demo", 16000, await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const viewer = new WebSocket(`ws://127.0.0.1:${await listen(router)}/projects/demo/api/screencast`);
    viewer.binaryType = "arraybuffer";
    const received = [];
    viewer.addEventListener("message", (event) => received.push(event.data));
    // A real client sends its view's size once it opens; the stream starts once it has one.
    viewer.addEventListener("open", () => {
      viewer.send(JSON.stringify({ type: "viewport", width: 800, height: 600, dpr: 1 }));
    });

    await until(() => received.some((message) => message instanceof ArrayBuffer));
    const frame = Buffer.from(received.find((message) => message instanceof ArrayBuffer));
    assert.equal(frame[0], 0); // JPEG_FRAME
    assert.deepEqual([frame.readUInt16BE(1), frame.readUInt16BE(3)], [800, 513]);
    assert.equal(frame.subarray(5).toString(), "jpeg");
    assert.ok(received.includes(JSON.stringify({ type: "tab" })));
    const [screencast] = browser.sent("Page.startScreencast");
    assert.equal(screencast.sessionId, `S-${PAGE}`);
    assert.equal(screencast.params.format, "jpeg");
    await until(() => browser.sent("Page.screencastFrameAck").length === 1);
    assert.deepEqual(browser.sent("Page.screencastFrameAck")[0].params, { sessionId: 7 });

    viewer.send(JSON.stringify({ type: "key", event: "down", key: "Enter", code: "Enter", keyCode: 13, text: "\r" }));
    viewer.send(JSON.stringify({ type: "mouse", event: "down", x: 10, y: 20, button: "left", buttons: 1 }));
    viewer.send(JSON.stringify({ type: "text", text: "pasted" }));
    viewer.send(JSON.stringify({ type: "navigate", url: "https://b.test/" }));
    await until(() => browser.sent("Input.insertText").length === 1);
    const [key] = browser.sent("Input.dispatchKeyEvent");
    assert.equal(key.sessionId, `S-${PAGE}`);
    assert.deepEqual([key.params.type, key.params.key, key.params.text], ["keyDown", "Enter", "\r"]);
    const [mouse] = browser.sent("Input.dispatchMouseEvent");
    assert.deepEqual([mouse.params.type, mouse.params.x, mouse.params.y], ["mousePressed", 10, 20]);
    assert.equal(browser.sent("Page.navigate").length, 0);

    // The first view sized the window for its page at ratio 1, and the viewers were told the
    // page's size.
    await until(() => received.includes(JSON.stringify({ type: "page", width: 800, height: 600 })));
    assert.deepEqual(browser.page(), { width: 800, height: 600, ratio: 1 });

    // A retina view: the window takes the view's size in window pixels plus the browser's
    // own toolbar, and the tab is drawn at pixel ratio 2. For the change of ratio the page's
    // CSS size is pinned while the window changes, and let go once the window has its size.
    // The view already sent its initial size when it connected, which sized the window once;
    // this resize is counted from there on, not from zero.
    const priorBounds = browser.sent("Browser.setWindowBounds").length;
    const priorMetrics = browser.sent("Emulation.setDeviceMetricsOverride").length;
    viewer.send(JSON.stringify({ type: "viewport", width: 800, height: 900, dpr: 2 }));
    await until(() => browser.sent("Emulation.setDeviceMetricsOverride").length === priorMetrics + 2);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds].params, {
      windowId: 1,
      bounds: { left: 0, top: 0, width: 1600, height: 1887 },
    });
    assert.deepEqual(
      browser.sent("Emulation.setDeviceMetricsOverride").slice(priorMetrics).map((command) => command.params),
      [
        { width: 800, height: 900, deviceScaleFactor: 2, mobile: false },
        { width: 0, height: 0, deviceScaleFactor: 2, scale: 2, mobile: false },
      ],
    );
    await until(() => received.includes(JSON.stringify({ type: "page", width: 800, height: 900 })));
    assert.deepEqual(browser.page(), { width: 800, height: 900, ratio: 2 });
    const frames = () => received.filter((message) => message instanceof ArrayBuffer);
    viewer.send(JSON.stringify({ type: "ack" }));
    browser.emit("Page.screencastFrame", {
      data: Buffer.from("sharp").toString("base64"),
      metadata: { deviceWidth: 1600, deviceHeight: 1800 },
      sessionId: 8,
    });
    await until(() => frames().length === 2);
    const sharp = Buffer.from(frames()[1]);
    assert.deepEqual([sharp.readUInt16BE(1), sharp.readUInt16BE(3)], [800, 900]);

    // A dialog is shown to the viewer, who can answer it.
    browser.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Sure?", url: "https://a.test/" });
    await until(() => received.some((message) => typeof message === "string" && message.includes("Sure?")));
    viewer.send(JSON.stringify({ type: "dialog", accept: true }));
    await until(() => browser.sent("Page.handleJavaScriptDialog").length === 1);
    assert.deepEqual(browser.sent("Page.handleJavaScriptDialog")[0].params, { accept: true });
    browser.emit("Page.javascriptDialogClosed", { result: true });
    await until(() => received.includes(JSON.stringify({ type: "dialog", open: false })));

    // While the agent acts on the page, the page keeps its CSS size and is drawn at ratio 1
    // and quality 75, and a new CSS size waits. Trusted input on the page more than a second
    // after the viewer's own is the agent's.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    browser.lastInput = Date.now();
    await until(() => browser.sent("Browser.setWindowBounds").length === priorBounds + 2);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds + 1].params.bounds, {
      left: 0,
      top: 0,
      width: 800,
      height: 987,
    });
    // Ratio 1 is emulated too, never cleared: a clear after the window changed size would
    // give the page an old size back (see BrowserLink).
    await until(() => browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params.deviceScaleFactor === 1);
    assert.deepEqual(browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params, {
      width: 0,
      height: 0,
      deviceScaleFactor: 1,
      scale: 1,
      mobile: false,
    });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 0);
    await until(() => browser.page().ratio === 1);
    assert.deepEqual(browser.page(), { width: 800, height: 900, ratio: 1 });
    assert.deepEqual(
      browser.sent("Page.startScreencast").map((command) => command.params.quality),
      [90, 75],
    );
    viewer.send(JSON.stringify({ type: "viewport", width: 900, height: 900, dpr: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(browser.sent("Browser.setWindowBounds").length, priorBounds + 2);

    // Once nobody watches, the page keeps its CSS size at the display's pixel ratio; a desktop
    // (VNC) viewer then has the window fill the screen again.
    viewer.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const routerPort = router.address().port;
    await upgradeStatus(routerPort, "/projects/demo/websockify", {});
    await until(() => browser.sent("Browser.setWindowBounds").length >= priorBounds + 3);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds + 2].params.bounds, {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
    // Without a live view the emulation ends, and the window is nudged (one pixel taller and
    // back) so the page takes the window's size rather than the one it had when the
    // emulation began.
    await until(() => browser.sent("Browser.setWindowBounds").length === priorBounds + 5);
    assert.deepEqual(
      browser.sent("Browser.setWindowBounds").slice(priorBounds + 3).map((command) => command.params.bounds.height),
      [1081, 1080],
    );
    await until(() => browser.sent("Emulation.clearDeviceMetricsOverride").length === 1);
    await until(() => browser.page().width === 1920);
    assert.deepEqual(browser.page(), { width: 1920, height: 993, ratio: 1 });
  });

  it("sizes a window from its visible tab", async () => {
    const browser = fakeBrowser([
      { id: BEHIND, visible: false },
      { id: PAGE, visible: true },
    ]);
    upstream = browser.server;
    const port = await listen(upstream);
    // Two callers at once share one DevTools connection.
    await Promise.all([
      setLiveViewport(port, { width: 800, height: 513, ratio: 1 }),
      setLiveViewport(port, { width: 800, height: 513, ratio: 1 }),
    ]);
    assert.equal(browser.connections, 1);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[0].params.bounds, {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    });
    await setLiveViewport(port, null);
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("resets a page's pixel ratio even when it has never set one itself", async () => {
    // A fresh BrowserLink, as the router starts with after a restart, has no record of what
    // ratio a page is at: if a live view was open when it stopped, the page can still be
    // emulated from before. Asking for ratio 1 must still run the CDP call, not skip it
    // because an unset ratio looks the same as one already known to be 1.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const link = new BrowserLink(port);
    assert.equal(await link.emulate(PAGE, null), true);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
    // Once this link has itself set a page to a ratio, asking for the same one again is a
    // no-op, as it always was.
    assert.equal(await link.emulate(PAGE, null), false);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
    await link.emulate(PAGE, 2);
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 1);
    await link.emulate(PAGE, 2);
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 1);
    // Ratio 1 is an emulation of its own, not a clear.
    assert.equal(await link.emulate(PAGE, 1), false);
    assert.deepEqual(browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params, {
      width: 0,
      height: 0,
      deviceScaleFactor: 1,
      scale: 1,
      mobile: false,
    });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
  });

  it("gives a page its window's size again when a cleared emulation left it at an old one", async () => {
    // Measured on the bench: a clear after the window changed size left a 3839 pixel wide
    // page in a 1280 pixel wide window. Its toolbar then reads as negative, the window keeper
    // could not measure it, and a live view that needed that measurement stayed on JPEG.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    browser.makeStale({ width: 3839, height: 2312 });
    await setLiveViewport(port, { width: 1280, height: 800, ratio: 1 });
    const bounds = browser.sent("Browser.setWindowBounds").map((command) => command.params.bounds);
    // One pixel taller and back, then the window for the live view.
    assert.deepEqual(bounds.slice(0, 2), [
      { left: 0, top: 0, width: 1920, height: 1081 },
      { left: 0, top: 0, width: 1920, height: 1080 },
    ]);
    assert.deepEqual(bounds.at(-1), { left: 0, top: 0, width: 1280, height: 887 });
    assert.deepEqual(browser.page(), { width: 1280, height: 800, ratio: 1 });
    assert.deepEqual(windowChrome(port), { width: 0, height: 87 });
    await setLiveViewport(port, null);
  });

  it("changes the window alone when the ratio stays, and pins the page only for a new ratio", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 1280, height: 800, ratio: 2 });
    const pins = () => browser.sent("Emulation.setDeviceMetricsOverride").filter((command) => command.params.width > 0);
    assert.equal(pins().length, 1);
    assert.deepEqual(browser.page(), { width: 1280, height: 800, ratio: 2 });
    await setLiveViewport(port, { width: 1000, height: 700, ratio: 2 });
    assert.equal(pins().length, 1);
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
      left: 0,
      top: 0,
      width: 2000,
      height: 1487,
    });
    assert.deepEqual(browser.page(), { width: 1000, height: 700, ratio: 2 });
    await setLiveViewport(port, { width: 1000, height: 700, ratio: 1 });
    assert.equal(pins().length, 2);
    assert.deepEqual(browser.page(), { width: 1000, height: 700, ratio: 1 });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 0);
    await setLiveViewport(port, null);
  });

  it("corrects a page's pixel ratio before reading its chrome, not after", async () => {
    // fitWindows reads a window's chrome (its tab strip and toolbar) from the page's own
    // outerWidth/innerWidth/devicePixelRatio; a page left emulated at the wrong ratio from
    // before this link's session throws that off. The fix must run early enough in the same
    // pass to still matter, not only after a measurement that pass already got wrong.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const link = new BrowserLink(port);
    await fitWindows(link);
    const emulateCalls = browser.sent("Emulation.clearDeviceMetricsOverride").length;
    assert.ok(emulateCalls > 0, "a fresh link corrects the ratio on its very first pass");
  });

  it("accepts the live view's WebSocket from the Plan origin only", async () => {
    await state("demo", 16000, 19201);
    router = createProjectBrowserRouter({ root });
    const port = await listen(router);
    const path = "/projects/demo/api/screencast";
    assert.equal(await upgradeStatus(port, path, { host: "plan.test", origin: "http://evil.test" }), 403);
    assert.equal(await upgradeStatus(port, "/projects/demo/api/tabs", {}), 404);
    assert.equal(await upgradeStatus(port, "/projects/other/api/screencast", {}), 404);
    assert.equal(isSameOrigin({ headers: { host: "plan.test", origin: "http://plan.test" } }), true);
    assert.equal(isSameOrigin({ headers: { host: "plan.test" } }), true);
    assert.equal(isSameOrigin({ headers: { host: "plan.test", origin: "null" } }), false);
  });

  it("lists the project browsers with a valid state for the window keeper", async () => {
    await state("demo", 16000, 19201);
    await fs.mkdir(path.join(root, "broken"), { mode: 0o700 });
    assert.deepEqual(await listProjectBrowsers(root), [{ slug: "demo", cdpPort: 19201 }]);
  });
});

describe("project browser control", () => {
  it("opens web addresses only", () => {
    assert.equal(navigableUrl("example.com/path"), "https://example.com/path");
    assert.equal(navigableUrl(" http://intranet.local "), "http://intranet.local/");
    assert.equal(navigableUrl("about:blank"), "about:blank");
    for (const refused of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", ""]) {
      assert.throws(() => navigableUrl(refused));
    }
  });

  it("accepts DevTools target ids only", () => {
    assert.equal(targetId("E9FA2045DECEE97DB2160D8A482371FF"), "E9FA2045DECEE97DB2160D8A482371FF");
    assert.throws(() => targetId("../json/version"));
  });

  it("fits a window to its screen unless it already fills it", () => {
    const screen = { width: 1280, height: 800 };
    assert.equal(
      fittedBounds({ windowState: "normal", left: 0, top: 0, width: 1280, height: 800 }, screen),
      null,
    );
    assert.deepEqual(
      fittedBounds({ windowState: "normal", left: 10, top: 10, width: 1920, height: 1080 }, screen),
      { left: 0, top: 0, width: 1280, height: 800 },
    );
    assert.deepEqual(
      fittedBounds({ windowState: "maximized", left: 0, top: 0, width: 1280, height: 800 }, screen),
      { left: 0, top: 0, width: 1280, height: 800 },
    );
    // Chromium without a window manager lands one pixel short of what it was given.
    assert.equal(
      fittedBounds({ windowState: "normal", left: 0, top: 0, width: 1279, height: 799 }, screen),
      null,
    );
    assert.equal(fittedBounds({ windowState: "normal" }, { width: 0, height: 0 }), null);
  });

  it("reads a tab's toolbar from its window and page, and tells a page that disagrees", () => {
    assert.deepEqual(readWindowSizes(["visible", 1920, 1080, 2560, 1687, 1280, 800, 2]), {
      visible: true,
      screen: { width: 1920, height: 1080 },
      outer: { width: 2560, height: 1687 },
      chrome: { width: 0, height: 87 },
      ratio: 2,
      consistent: true,
    });
    assert.equal(readWindowSizes(["visible", 3840, 2400, 1280, 887, 3839, 2312, 1]).consistent, false);
    assert.equal(readWindowSizes(["visible", 3840, 2400, 1280, 887, 640, 100, 1]).consistent, false);
    assert.equal(readWindowSizes(["visible", 1920, 1080, 0, 87]), null);
    assert.equal(readWindowSizes(null), null);
  });

  it("sizes a window to the live view's page plus the browser's toolbar while one is watched", () => {
    const screen = { width: 1920, height: 1080 };
    const chrome = { width: 0, height: 87 };
    assert.deepEqual(windowSize(screen, chrome, { width: 800, height: 513, ratio: 1 }), {
      width: 800,
      height: 600,
    });
    // A retina viewer's page is drawn at twice as many window pixels.
    assert.deepEqual(windowSize(screen, chrome, { width: 800, height: 513, ratio: 2 }), {
      width: 1600,
      height: 1113,
    });
    assert.deepEqual(windowSize(screen, chrome, undefined), screen);
  });
});
