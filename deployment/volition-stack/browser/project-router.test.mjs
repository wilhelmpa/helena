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
  fittedBounds,
  navigableUrl,
  setLiveViewport,
  targetId,
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
function fakeBrowser(tabs = [{ id: PAGE, visible: true }]) {
  const commands = [];
  const connections = new Set();
  let bounds = { left: 0, top: 0, width: 1920, height: 1080, windowState: "normal" };
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
        case "Browser.setWindowBounds":
          bounds = { ...bounds, ...message.params.bounds };
          return reply();
        case "Page.getFrameTree":
          return reply({ frameTree: { frame: { id: PAGE } } });
        case "Page.createIsolatedWorld":
          return reply({ executionContextId: 5 });
        case "Runtime.evaluate": {
          if (message.params.contextId) return reply({ result: { value: browser.lastInput } });
          const tab = tabs.find(({ id }) => message.sessionId === `S-${id}`);
          const sizes = tab.visible ? ["visible", 1920, 1080, 0, 87] : ["hidden", 1920, 1080, 0, 0];
          const visibilityOnly = message.params.expression === "document.visibilityState";
          return reply({ result: { value: visibilityOnly ? sizes[0] : sizes } });
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

    // A retina view: the window takes the view's size in window pixels plus the browser's
    // own toolbar, and the tab is drawn at pixel ratio 2. The page's CSS size is pinned while
    // the window changes.
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
    const clears = browser.sent("Emulation.clearDeviceMetricsOverride").length;
    browser.lastInput = Date.now();
    await until(() => browser.sent("Browser.setWindowBounds").length === priorBounds + 2);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds + 1].params.bounds, {
      left: 0,
      top: 0,
      width: 800,
      height: 987,
    });
    await until(() => browser.sent("Emulation.clearDeviceMetricsOverride").length === clears + 1);
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
    await until(() => browser.sent("Browser.setWindowBounds").length === priorBounds + 3);
    assert.deepEqual(browser.sent("Browser.setWindowBounds")[priorBounds + 2].params.bounds, {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
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
