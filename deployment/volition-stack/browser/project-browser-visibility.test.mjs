import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { BrowserLink, listTabs, releasePageVisibility, restorePageVisibility } from "./project-browser-control.mjs";
import { BrowserIdle, setPageLifecycle } from "./project-browser-idle.mjs";
import { acceptWebSocket } from "./websocket.mjs";

async function fixture(ids = ["selected"]) {
  const pages = ids.map((id) => ({ id, nativeVisible: false, frozen: true, captures: new Set() }));
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const base = `ws://127.0.0.1:${server.address().port}`;
    response.end(JSON.stringify(request.url === "/json/version" ? { webSocketDebuggerUrl: `${base}/browser` } : pages.map((page) => ({
      id: page.id, type: "page", title: page.id, url: `https://${page.id}.test/`, webSocketDebuggerUrl: `${base}/${page.id}`,
    }))));
  });
  server.on("upgrade", (request, socket, head) => acceptWebSocket(request, socket, head, (connection) => {
    sockets.add(connection);
    connection.on("close", () => {
      sockets.delete(connection);
      for (const page of pages) page.captures.delete(connection);
    });
    connection.on("message", (data) => {
      const { id, method, params = {}, sessionId } = JSON.parse(data.toString());
      const page = pages.find((entry) => entry.id === (sessionId ?? request.url.slice(1)));
      let result = {};
      if (method === "Target.attachToTarget") result = { sessionId: params.targetId };
      if (method === "Runtime.evaluate") result = { result: { value: page.nativeVisible || page.captures.size ? "visible" : "hidden" } };
      if (method === "Page.setWebLifecycleState") {
        page.frozen = params.state === "frozen";
        if (page.frozen) page.nativeVisible = false;
      }
      if (method === "Emulation.setFocusEmulationEnabled") {
        if (params.enabled) page.captures.add(connection);
        else page.captures.delete(connection);
      }
      connection.send(JSON.stringify({ id, result }));
    });
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { port, pages, async close() {
    await releasePageVisibility(port);
    for (const socket of sockets) socket.terminate();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  } };
}

async function until(predicate) {
  for (let tries = 0; tries < 50 && !predicate(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate());
}

test("agent-only wake paints the selected tab and releases it before idle freeze", async () => {
  const browser = await fixture();
  let time = 0;
  const idle = new BrowserIdle({ listBrowsers: async () => [{ slug: "demo", cdpPort: browser.port }], now: () => time });
  try {
    await idle.poll();
    idle.lock("demo", { kind: "agent" });
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].frozen, false);
    assert.equal(browser.pages[0].captures.size, 1);
    idle.lock("demo", null);
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 0);
    idle.lock("demo", { kind: "agent" });
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 1);
    idle.lock("demo", null);
    await idle.browsers.get("demo").queue;
    time = 120_000;
    await idle.poll();
    assert.equal(browser.pages[0].frozen, true);
    assert.equal(browser.pages[0].captures.size, 0);
    await idle.stop();
    assert.equal(browser.pages[0].captures.size, 0);
  } finally { await browser.close(); }
});

test("owner viewers share the lease until the last viewer closes", async () => {
  const browser = await fixture();
  const idle = new BrowserIdle({ listBrowsers: async () => [] });
  const first = new EventEmitter();
  const second = new EventEmitter();
  try {
    await idle.view("demo", browser.port, first);
    await idle.view("demo", browser.port, second);
    assert.equal(browser.pages[0].captures.size, 1);
    first.emit("close");
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 1);
    second.emit("close");
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 0);
    const reopened = new EventEmitter();
    await idle.view("demo", browser.port, reopened);
    assert.equal(browser.pages[0].captures.size, 1);
    idle.lock("demo", { kind: "agent" });
    await idle.browsers.get("demo").queue;
    reopened.emit("close");
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 1);
    idle.lock("demo", null);
    await idle.browsers.get("demo").queue;
    assert.equal(browser.pages[0].captures.size, 0);
  } finally { await browser.close(); }
});

test("a native tab switch wins over the captured tab's synthetic visibility", async () => {
  const browser = await fixture(["selected", "other"]);
  try {
    await setPageLifecycle(browser.port, "active");
    assert.equal(browser.pages[0].captures.size, 1);
    assert.equal((await listTabs(browser.port)).find((tab) => tab.active).id, "selected");
    browser.pages[1].nativeVisible = true;
    assert.equal((await listTabs(browser.port)).find((tab) => tab.active).id, "other");
    assert.equal(browser.pages[0].captures.size, 0);
    await restorePageVisibility(browser.port);
    assert.equal(browser.pages[1].captures.size, 0);
    await setPageLifecycle(browser.port, "frozen");
    assert.ok(browser.pages.every((page) => page.frozen && page.captures.size === 0));
  } finally { await browser.close(); }
});

test("closing the capture connection releases its renderer visibility", async () => {
  const browser = await fixture();
  const link = new BrowserLink(browser.port);
  try {
    await link.capture("selected");
    assert.equal(browser.pages[0].captures.size, 1);
    link.close();
    await until(() => browser.pages[0].captures.size === 0);
    assert.equal(link.captureTarget, null);
  } finally { link.close(); await browser.close(); }
});

test("a viewer closed during wake releases the lease after wake completes", async () => {
  let finishWake;
  let enteredWake;
  const entered = new Promise((resolve) => { enteredWake = resolve; });
  let leased = false;
  const idle = new BrowserIdle({
    listBrowsers: async () => [],
    lifecycle: async () => {
      enteredWake();
      await new Promise((resolve) => { finishWake = resolve; });
      leased = true;
      return 1;
    },
    releaseVisibility: async () => { leased = false; },
  });
  const viewer = new EventEmitter();
  const wake = idle.view("demo", 19205, viewer);
  await entered;
  viewer.emit("close");
  finishWake();
  await wake;
  await idle.browsers.get("demo").queue;
  assert.equal(leased, false);
});


test("a viewer arriving during lease release restores visibility after release", async () => {
  let finishRelease;
  let enteredRelease;
  const entered = new Promise((resolve) => { enteredRelease = resolve; });
  let leased = false;
  const idle = new BrowserIdle({
    listBrowsers: async () => [],
    lifecycle: async () => { leased = true; return 1; },
    releaseVisibility: async () => {
      enteredRelease();
      await new Promise((resolve) => { finishRelease = resolve; });
      leased = false;
    },
  });
  const first = new EventEmitter();
  await idle.view("demo", 19205, first);
  first.emit("close");
  await entered;
  const waking = idle.view("demo", 19205, new EventEmitter());
  finishRelease();
  await waking;
  assert.equal(leased, true);
});
