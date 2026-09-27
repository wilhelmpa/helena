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
  setGatewayTasks,
  shutdownProjectBrowserRouter,
} from "./project-router.mjs";
import {
  BrowserLink,
  fittedBounds,
  fitWindows,
  navigableUrl,
  readWindowSizes,
  setLiveViewport,
  setWindowCalibrationAllowed,
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
// It draws at device scale factor `scale` (2 unless a test says 1), so its window, screen and
// pages measure in DIP. Its pages report their sizes as Chromium 153 does (measured on the
// bench): a page pinned by an emulation keeps its CSS size and pixel ratio, and an emulation
// cleared after the window changed size meanwhile leaves the page at the size it had when the
// emulation began, until the window changes size again.
const CHROME_HEIGHT = 87;
function fakeBrowser(tabs = [{ id: PAGE, visible: true }], { scale = 2, rejectFirstScreencast = false } = {}) {
  const commands = [];
  const connections = new Set();
  let bounds = { left: 0, top: 0, width: 1920, height: 1080, windowState: "normal" };
  let zoom = 1;
  const pageStates = new Map(tabs.map(({ id }) => [id, { emulation: null, emulatedFrom: null, resizedWhileEmulated: false, stale: null }]));
  const windowPage = () => ({ width: bounds.width, height: bounds.height - CHROME_HEIGHT });
  const pageSizes = (id = PAGE) => {
    const state = pageStates.get(id);
    const size = state.emulation ?? { ...(state.stale ?? windowPage()), ratio: scale };
    return { width: size.width / zoom, height: size.height / zoom, ratio: size.ratio * zoom };
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
    pageStates.get(PAGE).stale = size;
  };
  browser.page = pageSizes;
  browser.setZoom = (value) => { zoom = value; };
  browser.bounds = () => bounds;
  server.once("listening", () => setWindowCalibrationAllowed(server.address().port, true));
  server.on("upgrade", (request, socket, head) => {
    upgraded.add(socket);
    browser.connections++;
    acceptWebSocket(request, socket, head, (connection) => {
      connections.add(connection);
      const owned = new Map();
      connection.on("close", () => {
        connections.delete(connection);
        for (const [id] of owned) {
          const state = pageStates.get(id);
          state.emulation = null;
          state.stale = null;
        }
      });
      connection.on("message", (data) => {
        const message = JSON.parse(data.toString());
        commands.push(message);
        const reply = (result = {}) => connection.send(JSON.stringify({ id: message.id, result }));
        const pageId = message.sessionId?.slice(2);
        const state = pageStates.get(pageId);
        switch (message.method) {
          case "Target.getTargets":
            return reply({ targetInfos: tabs.map(({ id }) => ({ targetId: id, type: "page" })) });
          case "Target.attachToTarget":
            browser.onAttach?.(message.params.targetId);
            return reply({ sessionId: `S-${message.params.targetId}` });
          case "Browser.getWindowBounds":
          case "Browser.getWindowForTarget":
            return reply({ windowId: 1, bounds });
          case "Browser.setWindowBounds": {
            const before = bounds;
            bounds = { ...bounds, ...message.params.bounds };
            if (before.width !== bounds.width || before.height !== bounds.height) {
              for (const state of pageStates.values()) {
                if (state.emulation) state.resizedWhileEmulated = true;
                else state.stale = null;
              }
            }
            if (browser.afterBounds) bounds = { ...bounds, ...browser.afterBounds(bounds) };
            return reply();
          }
          case "Emulation.setDeviceMetricsOverride": {
            const parameters = JSON.stringify(message.params);
            if (owned.get(pageId) === parameters) return reply();
            if (!owned.has(pageId)) {
              state.emulatedFrom = state.stale ?? windowPage();
              state.resizedWhileEmulated = false;
            }
            owned.set(pageId, parameters);
            const { width, height, deviceScaleFactor } = message.params;
            state.emulation = { width, height, ratio: deviceScaleFactor };
            return reply();
          }
          case "Emulation.clearDeviceMetricsOverride":
            if (!owned.delete(pageId)) return reply();
            if (state.emulation && state.resizedWhileEmulated) state.stale = state.emulatedFrom;
            state.emulation = null;
            return reply();
          case "Page.getLayoutMetrics":
            return reply(browser.metrics ?? { cssVisualViewport: { zoom } });
          case "Page.getFrameTree":
            return reply({ frameTree: { frame: { id: PAGE } } });
          case "Page.createIsolatedWorld":
            return reply({ executionContextId: 5 });
          case "Runtime.evaluate": {
            if (message.params.contextId) return reply({ result: { value: browser.lastInput } });
            if (message.params.awaitPromise) return reply({ result: { value: true } });
            const tab = tabs.find(({ id }) => message.sessionId === `S-${id}`);
            const page = pageSizes(tab.id);
            const visibility = tab.visible ? "visible" : "hidden";
            const sizes = [visibility, 1920, 1080, bounds.width, bounds.height, page.width, page.height, page.ratio];
            if (message.params.expression.includes("__clicks")) return reply({ result: { value: [] } });
            const visibilityOnly = message.params.expression === "document.visibilityState";
            return reply({ result: { value: visibilityOnly ? visibility : (browser.readSizes?.(sizes) ?? sizes) } });
          }
          case "Page.startScreencast":
            if (rejectFirstScreencast) {
              rejectFirstScreencast = false;
              return connection.send(JSON.stringify({ id: message.id, error: { code: -32000, message: "Page is waking" } }));
            }
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
    viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "hidden", hidden: false })));
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

    // The first view sized the window for its page, and the viewers were told the page's size.
    await until(() => received.includes(JSON.stringify({ type: "page", width: 800, height: 600, zoom: 1, fixed: false })));
    assert.deepEqual(browser.page(), { width: 800, height: 600, ratio: 2 });

    // A retina view: the window takes the view's CSS size plus the browser's own toolbar, in
    // DIP; the browser draws it at factor 2 itself, so nothing is emulated and CDP input stays
    // in CSS pixels. The JPEG frames come at ratio 2.
    // The view already sent its initial size when it connected, which sized the window once;
    // this resize is counted from there on, not from zero.
    const priorBounds = browser.sent("Browser.setWindowBounds").length;
    viewer.send(JSON.stringify({ type: "viewport", width: 800, height: 900, dpr: 2 }));
    await until(() => received.includes(JSON.stringify({ type: "page", width: 800, height: 900, zoom: 1, fixed: false })));
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds].params, {
      windowId: 1,
      bounds: { left: 0, top: 0, width: 800, height: 987 },
    });
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
    assert.deepEqual(browser.page(), { width: 800, height: 900, ratio: 2 });
    await until(() => browser.sent("Page.startScreencast").at(-1).params.maxWidth === 1600);
    const frames = () => received.filter((message) => message instanceof ArrayBuffer).map((data) => Buffer.from(data));
    const sharpFrame = () => frames().find((frame) => frame.subarray(5).toString() === "sharp");
    for (let acks = 0; acks < 4; acks++) viewer.send(JSON.stringify({ type: "ack" }));
    browser.emit("Page.screencastFrame", {
      data: Buffer.from("sharp").toString("base64"),
      metadata: { deviceWidth: 800, deviceHeight: 900 },
      sessionId: 8,
    });
    await until(() => sharpFrame() !== undefined);
    const sharp = sharpFrame();
    assert.deepEqual([sharp.readUInt16BE(1), sharp.readUInt16BE(3)], [800, 900]);

    // A dialog is shown to the viewer, who can answer it.
    browser.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Sure?", url: "https://a.test/" });
    await until(() => received.some((message) => typeof message === "string" && message.includes("Sure?")));
    viewer.send(JSON.stringify({ type: "dialog", accept: true }));
    await until(() => browser.sent("Page.handleJavaScriptDialog").length === 1);
    assert.deepEqual(browser.sent("Page.handleJavaScriptDialog")[0].params, { accept: true });
    browser.emit("Page.javascriptDialogClosed", { result: true });
    await until(() => received.includes(JSON.stringify({ type: "dialog", open: false })));

    // While the agent acts on the page, the page keeps its CSS size, and a JPEG stream sends
    // frames at ratio 1 and quality 75, and a new CSS size waits. Trusted input on the page
    // more than a second after the viewer's own is the agent's.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    browser.lastInput = Date.now();
    await until(() => browser.sent("Page.startScreencast").at(-1).params.quality === 75);
    assert.deepEqual(
      browser.sent("Page.startScreencast").slice(-1).map(({ params }) => [params.maxWidth, params.maxHeight]),
      [[800, 900]],
    );
    assert.equal(browser.sent("Browser.setWindowBounds").length, priorBounds + 1);
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
    viewer.send(JSON.stringify({ type: "viewport", width: 900, height: 900, dpr: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(browser.sent("Browser.setWindowBounds").length, priorBounds + 1);

    // Once nobody watches, the page keeps its CSS size; a desktop (VNC) viewer then has the
    // window fill the screen again.
    viewer.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const routerPort = router.address().port;
    await upgradeStatus(routerPort, "/projects/demo/websockify", {});
    await until(() => browser.sent("Browser.setWindowBounds").at(-1).params.bounds.width === 1920);
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
    assert.deepEqual(browser.page(), { width: 1920, height: 993, ratio: 2 });
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
  });

  it("recovers a refused first stream on the existing tab without creating another tab", async () => {
    const browser = fakeBrowser(undefined, { rejectFirstScreencast: true });
    upstream = browser.server;
    await state("demo", 16000, await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const viewer = new WebSocket(`ws://127.0.0.1:${await listen(router)}/projects/demo/api/screencast`);
    viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "hidden", hidden: false })));
    viewer.binaryType = "arraybuffer";
    const received = [];
    viewer.addEventListener("message", (event) => received.push(event.data));
    viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "viewport", width: 800, height: 600, dpr: 1 })));
    await until(() => received.some((message) => message instanceof ArrayBuffer));
    assert.ok(browser.sent("Page.startScreencast").length >= 2);
    assert.equal(browser.sent("Target.createTarget").length, 0);
    assert.ok(browser.sent("Page.startScreencast").every(({ sessionId }) => sessionId === `S-${PAGE}`));
    viewer.close();
  });

  it("draws a small page sharp until an agent takes hold of a tab, then at a ratio it can click from", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    await state("demo", 16000, await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const viewer = new WebSocket(`ws://127.0.0.1:${await listen(router)}/projects/demo/api/screencast`);
    viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "hidden", hidden: false })));
    viewer.addEventListener("open", () => {
      viewer.send(JSON.stringify({ type: "viewport", width: 619, height: 612, dpr: 2 }));
    });
    await until(() => browser.page().width === 619);
    assert.deepEqual(browser.page(), { width: 619, height: 612, ratio: 2 });
    // browser-harness marks the title of the tab it attaches to: its screenshots of a page
    // this small would be off by 2 at ratio 2, so the page is pinned at ratio 1.
    browser.emit("Target.targetInfoChanged", { targetInfo: { targetId: PAGE, type: "page", title: "\u{1F434} Page" } });
    await until(() => browser.page().ratio === 1);
    assert.deepEqual(browser.page(), { width: 620, height: 612, ratio: 1 });
    assert.deepEqual(browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params, {
      width: 620,
      height: 612,
      deviceScaleFactor: 1,
      mobile: false,
    });
    viewer.close();
  });

  it("does not take a viewer's own click for the agent's", async () => {
    // The page records the press before the router has sent the release: measured against the
    // release alone, every click of a viewer read as the agent's, which held the page's size
    // and lowered the JPEG quality for 30 seconds.
    const browser = fakeBrowser();
    upstream = browser.server;
    await state("demo", 16000, await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const viewer = new WebSocket(`ws://127.0.0.1:${await listen(router)}/projects/demo/api/screencast`);
    viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "hidden", hidden: false })));
    const received = [];
    viewer.addEventListener("message", (event) => received.push(event.data));
    await new Promise((resolve) => viewer.addEventListener("open", resolve));
    viewer.send(JSON.stringify({ type: "viewport", width: 800, height: 600, dpr: 2 }));
    await until(() => browser.page().width === 800);
    const pressedAt = Date.now();
    viewer.send(JSON.stringify({ type: "mouse", event: "down", x: 10, y: 10, button: "left", buttons: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    viewer.send(JSON.stringify({ type: "mouse", event: "up", x: 10, y: 10, button: "left", buttons: 0 }));
    await until(() => browser.sent("Input.dispatchMouseEvent").length === 2);
    browser.lastInput = pressedAt + 5;
    // The activity is read once a second.
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    assert.ok(!received.includes(JSON.stringify({ type: "control", by: "agent" })));
    viewer.send(JSON.stringify({ type: "viewport", width: 900, height: 600, dpr: 2 }));
    await until(() => browser.page().width === 900);
    viewer.close();
  });

  it("lets the view that last changed size set the page's size, not a held, hidden or fixed one", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    await state("demo", 16000, await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const routerPort = await listen(router);
    const open = async () => {
      const viewer = new WebSocket(`ws://127.0.0.1:${routerPort}/projects/demo/api/screencast`);
      viewer.addEventListener("open", () => viewer.send(JSON.stringify({ type: "hidden", hidden: false })));
      viewer.messages = [];
      viewer.addEventListener("message", (event) => viewer.messages.push(event.data));
      await new Promise((resolve) => viewer.addEventListener("open", resolve));
      return viewer;
    };
    const view = (viewer, size) => viewer.send(JSON.stringify({ type: "viewport", dpr: 2, ...size }));
    const mac = await open();
    view(mac, { width: 900, height: 800 });
    await until(() => browser.page().width === 900);
    // A second view joins beside it: it shows the page scaled and does not take its size.
    const kiosk = await open();
    view(kiosk, { width: 1900, height: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(browser.page().width, 900);
    // Someone works in it: now it owns the size.
    kiosk.send(JSON.stringify({ type: "focus" }));
    await until(() => browser.page().width === 1900);
    // The first one resizes its panel: the page follows it again.
    view(mac, { width: 1000, height: 800 });
    await until(() => browser.page().width === 1000);
    // A view that holds the size ("Größe festhalten") only scales; a hidden one does not count.
    view(kiosk, { width: 1800, height: 1000, hold: true });
    kiosk.send(JSON.stringify({ type: "focus" }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(browser.page().width, 1000);
    mac.send(JSON.stringify({ type: "hidden", hidden: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(browser.page().width, 1000);
    mac.send(JSON.stringify({ type: "hidden", hidden: false }));

    // The gateway holds a working size while an agent steers: no view changes it.
    const post = (body) =>
      fetch(`http://127.0.0.1:${routerPort}/projects/demo/api/viewport`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (response) => [response.status, await response.json()]);
    assert.deepEqual(await post({ mode: "fixed", holder: "Coder VOL" }), [
      200,
      { mode: "fixed", width: 1440, height: 900, holder: "Coder VOL" },
    ]);
    await until(() => browser.page().width === 1440);
    assert.deepEqual(browser.page(), { width: 1440, height: 900, ratio: 2 });
    await until(() => mac.messages.some((message) => typeof message === "string" && message.includes('"holder":"Coder VOL"')));
    view(mac, { width: 700, height: 700 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(browser.page().width, 1440);
    assert.equal((await post({ mode: "fixed", width: 10, height: 10 }))[0], 400);
    assert.deepEqual(await post({ mode: "follow" }), [200, { mode: "follow" }]);
    await until(() => browser.page().width === 700);
    mac.close();
    kiosk.close();
  });

  it("rejects plausible foreign geometry until that owning session detaches", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const foreign = new BrowserLink(port);
    try {
      await foreign.pin(PAGE, { width: 1920, height: 1080, ratio: 1 });
      await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
      assert.equal(windowChrome(port), null);
      assert.deepEqual(browser.page(), { width: 1920, height: 1080, ratio: 1 });
      const attempts = browser.sent("Browser.setWindowBounds").length;
      await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
      assert.equal(browser.sent("Browser.setWindowBounds").length, attempts);
      foreign.close();
      await until(() => browser.page().ratio === 2);
      await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
      assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 2 });
      assert.deepEqual(browser.page(), { width: 800, height: 513, ratio: 2 });
    } finally { foreign.close(); }
  });

  it("invalidates an earlier trusted crop when a foreign override changes geometry", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
    assert.ok(windowChrome(port));
    const foreign = new BrowserLink(port);
    try {
      await foreign.pin(PAGE, { width: 800, height: 600, ratio: 1 });
      await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
      assert.equal(windowChrome(port), null);
    } finally { foreign.close(); }
  });

  it("remeasures after a foreign detach resets the router's later pin", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const foreign = new BrowserLink(port);
    try {
      await foreign.pin(PAGE, { width: 1920, height: 1080, ratio: 1 });
      await setLiveViewport(port, { width: 620, height: 612, ratio: 1, pin1: true });
      assert.equal(windowChrome(port), null);
      assert.deepEqual(browser.page(), { width: 620, height: 612, ratio: 1 });
      foreign.close();
      await until(() => browser.page().ratio === 2);
      await setLiveViewport(port, { width: 620, height: 612, ratio: 1, pin1: true });
      assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 2 });
      assert.deepEqual(browser.page(), { width: 620, height: 612, ratio: 1 });
    } finally { foreign.close(); }
  });

  it("does not calibrate unknown or agent-held geometry, and clears crop on connection loss", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    setWindowCalibrationAllowed(port, false);
    await setLiveViewport(port, { width: 800, height: 513, ratio: 2 });
    assert.equal(windowChrome(port), null);
    assert.equal(browser.sent("Browser.setWindowBounds").length, 0);
    const link = new BrowserLink(port);
    link.chrome = { width: 0, height: 87 };
    link.close();
    assert.equal(link.chrome, null);
    link.chrome = { width: 0, height: 87 };
    await link.open();
    assert.equal(link.chrome, null);
    link.close();
  });

  it("waits for the restored page to reflow after its native bounds already match", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    let writes = 0;
    let pendingReads = 0;
    browser.afterBounds = (bounds) => {
      if (++writes === 2) pendingReads = 2;
      return bounds;
    };
    browser.readSizes = (sizes) => {
      if (pendingReads > 0) {
        pendingReads--;
        return sizes.map((value, index) => index === 5 || index === 6 ? value - 8 : value);
      }
      return sizes;
    };
    await setLiveViewport(port, { width: 620, height: 632, ratio: 2 });
    assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 2 });
    assert.deepEqual(browser.page(), { width: 620, height: 632, ratio: 2 });
  });

  for (const [change, requested] of [
    ["size", { width: 1280, height: 680, ratio: 2 }],
    ["pin", { width: 620, height: 632, ratio: 1, pin1: true }],
  ]) it(`retries an unconfirmed native calibration for a new owner viewport ${change}`, async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const original = browser.bounds();
    // The display temporarily ignores the probe, without changing the page's geometry.
    browser.afterBounds = () => original;
    await setLiveViewport(port, { width: 620, height: 632, ratio: 2 });
    assert.equal(windowChrome(port), null);
    assert.deepEqual(browser.bounds(), original);
    const attempted = browser.sent("Browser.setWindowBounds").length;
    browser.afterBounds = null;
    await setLiveViewport(port, { width: 620, height: 632, ratio: 2 });
    assert.equal(browser.sent("Browser.setWindowBounds").length, attempted);
    await setLiveViewport(port, requested);
    assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 2 });
    assert.deepEqual(browser.page(), { width: requested.width, height: requested.height, ratio: requested.ratio });
  });

  it("distinguishes equal pixel extents with different CSS size and DPR after detach", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 1440, height: 900, ratio: 1, pin1: true });
    const foreign = new BrowserLink(port);
    try {
      await foreign.pin(PAGE, { width: 1440, height: 900, ratio: 1 });
      await (await foreign.open()).send("Browser.setWindowBounds", { windowId: 1, bounds: { width: 720, height: 537 } });
      foreign.close();
      await until(() => browser.page().ratio === 2);
      assert.deepEqual(browser.page(), { width: 720, height: 450, ratio: 2 });
      await setLiveViewport(port, { width: 1440, height: 900, ratio: 1, pin1: true });
      assert.deepEqual(browser.page(), { width: 1440, height: 900, ratio: 1 });
    } finally { foreign.close(); }
  });

  it("preserves a real page zoom when validating the router's existing pin", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
    browser.setZoom(1.25);
    const clears = browser.sent("Emulation.clearDeviceMetricsOverride").length;
    await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, clears);
    assert.deepEqual(browser.page(), { width: 336, height: 240, ratio: 1.25 });
    assert.ok(windowChrome(port));
  });

  it("abandons a calibration and old owner fit after agent authority or window state changes", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    browser.afterBounds = () => {
      setWindowCalibrationAllowed(port, false);
      browser.afterBounds = null;
      return { width: 1111, height: 777, windowState: "maximized" };
    };
    await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
    assert.equal(browser.sent("Browser.setWindowBounds").length, 1);
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
    assert.deepEqual(browser.bounds(), { left: 0, top: 0, width: 1111, height: 777, windowState: "maximized" });
    assert.equal(windowChrome(port), null);
  });

  it("does not dispatch or cache a pin when authority changes while attaching", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const link = new BrowserLink(port);
    let allowed = true;
    browser.onAttach = () => { allowed = false; };
    try {
      await link.pin(PAGE, { width: 620, height: 300, ratio: 1 }, () => allowed);
      assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
      assert.equal(link.pins.has(PAGE), false);
    } finally { link.close(); }
  });

  it("uses JPEG without changing a pin when page zoom cannot be measured", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
    const clears = browser.sent("Emulation.clearDeviceMetricsOverride").length;
    browser.metrics = {};
    await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, clears);
    assert.deepEqual(browser.page(), { width: 420, height: 300, ratio: 1 });
    assert.equal(windowChrome(port), null);
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
      setLiveViewport(port, { width: 800, height: 513, ratio: 2 }),
      setLiveViewport(port, { width: 800, height: 513, ratio: 2 }),
    ]);
    assert.equal(browser.connections, 1);
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
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

  it("clears only its own session emulation, and pins only on request", async () => {
    // A fresh session may issue clear, but it does not own another session's override.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const link = new BrowserLink(port);
    assert.equal(await link.pin(PAGE, null), false);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
    assert.equal(await link.pin(PAGE, null), false);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
    assert.equal(await link.pin(PAGE, { width: 600, height: 500, ratio: 1 }), false);
    assert.deepEqual(browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params, {
      width: 600,
      height: 500,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await link.pin(PAGE, { width: 600, height: 500, ratio: 1 });
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 1);
    assert.equal(await link.pin(PAGE, null), true);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 2);
  });

  it("gives a page its window's size again when a cleared emulation left it at an old one", async () => {
    // Measured on the bench: a clear after the window changed size left a 3839 pixel wide
    // page in a 1280 pixel wide window. Its toolbar then reads as negative, the window keeper
    // could not measure it, and a live view that needed that measurement stayed on JPEG.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    browser.makeStale({ width: 3839, height: 2312 });
    await setLiveViewport(port, { width: 1280, height: 800, ratio: 2 });
    const bounds = browser.sent("Browser.setWindowBounds").map((command) => command.params.bounds);
    // Measure during a native size change and after restoration, then fit the live view.
    assert.deepEqual(bounds.slice(0, 2), [
      { left: 0, top: 0, width: 1912, height: 1072 },
      { left: 0, top: 0, width: 1920, height: 1080 },
    ]);
    assert.deepEqual(bounds.at(-1), { left: 0, top: 0, width: 1280, height: 887 });
    assert.deepEqual(browser.page(), { width: 1280, height: 800, ratio: 2 });
    assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 2 });
    await setLiveViewport(port, null);
  });

  it("sizes the window in DIP, pins a page only for ratio 1, and nudges it when it lets go", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 1280, height: 800, ratio: 2 });
    assert.deepEqual(browser.page(), { width: 1280, height: 800, ratio: 2 });
    await setLiveViewport(port, { width: 1000, height: 700, ratio: 2 });
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
      left: 0,
      top: 0,
      width: 1000,
      height: 787,
    });
    assert.deepEqual(browser.page(), { width: 1000, height: 700, ratio: 2 });
    assert.equal(browser.sent("Emulation.setDeviceMetricsOverride").length, 0);
    // A page pinned at ratio 1 is pinned at its new size before its window changes.
    await setLiveViewport(port, { width: 620, height: 612, ratio: 1, pin1: true });
    const commands = browser.commands.map((command) => command.method);
    assert.ok(
      commands.lastIndexOf("Emulation.setDeviceMetricsOverride") < commands.lastIndexOf("Browser.setWindowBounds"),
    );
    assert.deepEqual(browser.page(), { width: 620, height: 612, ratio: 1 });
    // Letting it go clears the emulation and nudges the window, so the page takes the window's
    // size, not the one it had before it was pinned.
    const clears = browser.sent("Emulation.clearDeviceMetricsOverride").length;
    await setLiveViewport(port, { width: 900, height: 700, ratio: 2 });
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, clears + 1);
    assert.deepEqual(browser.sent("Browser.setWindowBounds").slice(-2).map(({ params }) => params.bounds.height), [
      788,
      787,
    ]);
    assert.deepEqual(browser.page(), { width: 900, height: 700, ratio: 2 });
    await setLiveViewport(port, null);
  });

  it("pins a page narrower than a window can be at its width, at the browser's own factor", async () => {
    // A phone's 390 CSS pixel view: Chromium keeps a window 500 DIP wide.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 390, height: 700, ratio: 2 });
    assert.deepEqual(browser.sent("Browser.setWindowBounds").at(-1).params.bounds, {
      left: 0,
      top: 0,
      width: 500,
      height: 787,
    });
    assert.deepEqual(browser.sent("Emulation.setDeviceMetricsOverride").at(-1).params, {
      width: 390,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    assert.deepEqual(browser.page(), { width: 390, height: 700, ratio: 2 });
    await setLiveViewport(port, null);
  });

  it("reads the browser's factor 1 as well, drawing pages as before", async () => {
    const browser = fakeBrowser(undefined, { scale: 1 });
    upstream = browser.server;
    const port = await listen(upstream);
    await setLiveViewport(port, { width: 1000, height: 700, ratio: 1 });
    assert.deepEqual(windowChrome(port), { width: 0, height: 87, scale: 1 });
    assert.deepEqual(browser.page(), { width: 1000, height: 700, ratio: 1 });
    await setLiveViewport(port, null);
  });

  it("leaves the windows alone just after a restart until a live view or the screen asks", async () => {
    // A live view open when the router restarted reconnects within seconds; filling the
    // screen meanwhile would lay its page out twice.
    const browser = fakeBrowser();
    upstream = browser.server;
    const port = await listen(upstream);
    const restarted = await import("./project-browser-control.mjs?startup-grace");
    const link = new restarted.BrowserLink(port);
    try {
      await restarted.fitWindows(link);
      assert.equal(link.chrome, null);
      assert.equal(browser.sent("Browser.setWindowBounds").length, 0);
      assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 0);
    } finally { link.close(); }
    // An explicit screen request permits owner calibration and clearing our own emulation.
    await setLiveViewport(port, null);
    assert.equal(browser.sent("Emulation.clearDeviceMetricsOverride").length, 1);
  });

  it("closes live and desktop WebSockets and their streams on shutdown", async () => {
    const browser = fakeBrowser();
    upstream = browser.server;
    const browserPort = await listen(upstream);
    await state("demo", browserPort, browserPort);
    router = createProjectBrowserRouter({ root });
    const port = await listen(router);
    const live = new WebSocket(`ws://127.0.0.1:${port}/projects/demo/api/screencast`);
    live.addEventListener("open", () => live.send(JSON.stringify({ type: "hidden", hidden: false })));
    const desktop = new WebSocket(`ws://127.0.0.1:${port}/projects/demo/vnc.html`);
    await Promise.all([live, desktop].map((socket, index) => new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(index === 0 ? "live failed" : "desktop failed")), { once: true });
    })));
    live.send(JSON.stringify({ type: "viewport", width: 800, height: 600, dpr: 1 }));
    await until(() => browser.sent("Page.startScreencast").length > 0);
    const closed = [live, desktop].map((socket) => new Promise((resolve) => socket.addEventListener("close", resolve, { once: true })));
    const started = Date.now();
    assert.equal(await shutdownProjectBrowserRouter(router, { idle: { stop: async () => {} }, timeoutMs: 500 }), true);
    await Promise.all(closed);
    assert.ok(Date.now() - started < 500);
    assert.equal(live.readyState, WebSocket.CLOSED);
    assert.equal(desktop.readyState, WebSocket.CLOSED);
    // A second stop is harmless and shares the completed shutdown.
    assert.equal(await shutdownProjectBrowserRouter(router), true);
  });

  it("bounds shutdown even when idle wakeup cannot finish and a proxy response hangs", async () => {
    let pendingRequest = false;
    upstream = http.createServer(() => { pendingRequest = true; });
    await state("demo", await listen(upstream));
    router = createProjectBrowserRouter({ root });
    const port = await listen(router);
    const pending = fetch(`http://127.0.0.1:${port}/projects/demo/vnc.html`).catch(() => null);
    await until(() => pendingRequest);
    const started = Date.now();
    assert.equal(await shutdownProjectBrowserRouter(router, {
      idle: { stop: () => new Promise(() => {}) },
      timeoutMs: 75,
    }), false);
    assert.ok(Date.now() - started < 500);
    assert.equal(await pending, null);
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

  it("wakes a paused page before accepting a live view", async () => {
    await state("demo", 16000, 19201);
    let releaseWake;
    let waking = false;
    const idle = {
      record() {},
      wake() {
        waking = true;
        return new Promise((resolve) => { releaseWake = resolve; });
      },
      view() {},
    };
    router = createProjectBrowserRouter({ root, idle });
    const port = await listen(router);
    let accepted = false;
    const status = upgradeStatus(port, "/projects/demo/api/screencast", {
      host: "plan.test",
      origin: "http://plan.test",
    }).then((code) => { accepted = true; return code; });
    await until(() => waking);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(accepted, false);
    releaseWake();
    assert.equal(await status, 101);
  });

  it("rejects a stream handshake when an existing page could not be awakened", async () => {
    await state("demo", 16000, 19201);
    router = createProjectBrowserRouter({ root, idle: { record() {}, wake: async () => false } });
    assert.equal(await upgradeStatus(await listen(router), "/projects/demo/api/screencast", {
      host: "plan.test", origin: "http://plan.test",
    }), 503);
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

  it("reads a tab's toolbar and the browser's factor from its window and page, and tells a page that disagrees", () => {
    // Factor 2: window and page in DIP, devicePixelRatio 2.
    assert.deepEqual(readWindowSizes(["visible", 1920, 1200, 1280, 887, 1280, 800, 2]), {
      visible: true,
      screen: { width: 1920, height: 1200 },
      outer: { width: 1280, height: 887 },
      inner: { width: 1280, height: 800 },
      chrome: { width: 0, height: 87 },
      scale: 2,
      ratio: 2,
      consistent: true,
    });
    // Factor 1, and factor 2 at 125 % page zoom.
    assert.equal(readWindowSizes(["visible", 3840, 2400, 1280, 887, 1280, 800, 1]).scale, 1);
    const zoomed = readWindowSizes(["visible", 1920, 1200, 1280, 887, 1024, 640, 2.5]);
    assert.deepEqual([zoomed.scale, zoomed.chrome], [2, { width: 0, height: 87 }]);
    // A page wider than its window: an emulation cleared after a resize.
    assert.equal(readWindowSizes(["visible", 3840, 2400, 1280, 887, 3839, 2312, 1]).consistent, false);
    assert.equal(readWindowSizes(["visible", 1920, 1200, 1280, 887, 3839, 2312, 2]).consistent, false);
    assert.equal(readWindowSizes(["visible", 1920, 1080, 0, 87]), null);
    assert.equal(readWindowSizes(null), null);
  });

  it("sizes a window to the live view's page plus the browser's toolbar while one is watched", () => {
    const screen = { width: 1920, height: 1080 };
    const chrome = { width: 0, height: 87 };
    // In DIP, whatever the frames' ratio: the browser draws at its own factor.
    assert.deepEqual(windowSize(screen, chrome, { width: 800, height: 513, ratio: 1 }), {
      width: 800,
      height: 600,
    });
    assert.deepEqual(windowSize(screen, chrome, { width: 800, height: 513, ratio: 2 }), {
      width: 800,
      height: 600,
    });
    assert.deepEqual(windowSize(screen, chrome, undefined), screen);
  });
});

describe("Browser 2.0's internal routes", () => {
  it("start a run only for the API: loopback, POST, the gateway token, no forwarding headers", async () => {
    const started = [];
    setGatewayTasks({
      authorized: (header) => header === "Bearer gateway-token-0123456789abcdef",
      startLab: async (body) => void started.push(["lab", body.slug]),
      startJevBrowser: async (body) => void started.push(["jev-browser", body.slug]),
    });
    router = createProjectBrowserRouter({ root });
    const base = `http://127.0.0.1:${await listen(router)}/internal/gateway`;
    const post = (path, headers = {}) =>
      fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-token-0123456789abcdef",
          connection: "close",
          ...headers,
        },
        body: JSON.stringify({ slug: "demo" }),
      });

    assert.equal((await post("lab")).status, 202);
    assert.equal((await post("jev-browser")).status, 202);
    assert.deepEqual(started, [
      ["lab", "demo"],
      ["jev-browser", "demo"],
    ]);
    // Through nginx (forwarding headers), with another token, or not a POST: refused, nothing starts.
    assert.equal((await post("lab", { "x-real-ip": "192.168.2.10" })).status, 404);
    assert.equal((await post("lab", { "x-forwarded-for": "192.168.2.10" })).status, 404);
    assert.equal((await post("lab", { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await fetch(`${base}/lab`, { headers: { connection: "close" } })).status, 404);
    assert.equal((await post("other")).status, 404);
    assert.equal(started.length, 2);
    setGatewayTasks(null);
  });

  it("answers 404 while the gateway is not running", async () => {
    setGatewayTasks(null);
    router = createProjectBrowserRouter({ root });
    const response = await fetch(`http://127.0.0.1:${await listen(router)}/internal/gateway/lab`, {
      method: "POST",
      headers: { connection: "close" },
      body: "{}",
    });
    assert.equal(response.status, 404);
  });
});
