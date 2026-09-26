import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { BrowserIdle, setPageLifecycle } from "./project-browser-idle.mjs";
import { CdpConnection } from "./project-browser-control.mjs";

test("project pages pause only when nobody uses the browser and resume on use", async () => {
  let time = 0;
  const states = [];
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "home", cdpPort: 9222 }],
    lifecycle: async (port, state) => {
      states.push([port, state]);
      return 1;
    },
    now: () => time,
  });

  await idle.poll();
  time = 119_999;
  await idle.poll();
  assert.deepEqual(states, []);

  time = 120_000;
  await idle.poll();
  assert.deepEqual(states, [[9222, "frozen"]]);

  const viewer = new EventEmitter();
  await idle.view("home", 9222, viewer);
  assert.deepEqual(states.at(-1), [9222, "active"]);

  time = 500_000;
  await idle.poll();
  assert.deepEqual(states.at(-1), [9222, "active"]);

  viewer.emit("close");
  time += 120_000;
  await idle.poll();
  assert.deepEqual(states.at(-1), [9222, "frozen"]);

  idle.lock("home", { kind: "agent" });
  await idle.wake("home");
  assert.deepEqual(states.at(-1), [9222, "active"]);
  idle.lock("home", null);
  time += 120_000;
  await idle.poll();
  assert.deepEqual(states.at(-1), [9222, "frozen"]);
  await idle.stop();
  assert.deepEqual(states.at(-1), [9222, "active"]);
});

test("a viewer arriving during a pause leaves the page active", async () => {
  let time = 0;
  let releaseFreeze;
  let freezeStarted;
  const freezing = new Promise((resolve) => { freezeStarted = resolve; });
  const states = [];
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "verve", cdpPort: 19204 }],
    lifecycle: async (_port, state) => {
      states.push(state);
      if (state === "frozen") {
        await new Promise((resolve) => {
          releaseFreeze = resolve;
          freezeStarted();
        });
      }
      return 1;
    },
    now: () => time,
  });
  await idle.poll();
  time = 120_000;
  const pausing = idle.poll();
  await freezing;
  const viewer = new EventEmitter();
  const waking = idle.view("verve", 19204, viewer);
  releaseFreeze();
  await pausing;
  await waking;
  assert.deepEqual(states, ["frozen", "active"]);
});


test("first viewer wakes a page frozen by a previous router process", async () => {
  const states = [];
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "verve", cdpPort: 19204 }],
    lifecycle: async (_port, state) => { states.push(state); return 1; },
  });
  await idle.poll();
  assert.deepEqual(states, []);
  await idle.view("verve", 19204, new EventEmitter());
  assert.deepEqual(states, ["active"]);
});

test("reconnecting an existing live view activates pages even when remembered as active", async () => {
  const states = [];
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19205 }],
    lifecycle: async (_port, state) => { states.push(state); return 1; },
  });
  await idle.poll();
  await idle.wake("vol");
  await idle.wake("vol", { force: true });
  assert.deepEqual(states, ["active", "active"]);
});

test("a partially failed page wake stays retryable and is reported to the handshake", async () => {
  let failed = true;
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19205 }],
    lifecycle: async () => { if (failed) throw new Error("page remains frozen"); return 2; },
  });
  await idle.poll();
  assert.equal(await idle.wake("vol"), false);
  assert.equal(idle.browsers.get("vol").frozen, true);
  failed = false;
  assert.equal(await idle.wake("vol"), true);
  assert.equal(idle.browsers.get("vol").frozen, false);
});

test("lifecycle activation requires every tab, not just one successful tab", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpen = CdpConnection.open;
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { type: "page", url: "https://a.test", webSocketDebuggerUrl: "ws://one" },
    { type: "page", url: "https://b.test", webSocketDebuggerUrl: "ws://two" },
  ] });
  CdpConnection.open = async (url) => ({
    send: async () => { if (url === "ws://two") throw new Error("still frozen"); },
    close() {},
  });
  try {
    await assert.rejects(setPageLifecycle(19205, "active"), /every project browser page/);
  } finally {
    globalThis.fetch = originalFetch;
    CdpConnection.open = originalOpen;
  }
});
