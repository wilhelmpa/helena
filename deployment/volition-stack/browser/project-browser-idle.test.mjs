import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { BrowserIdle } from "./project-browser-idle.mjs";

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
