import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BrowserIdle } from "./project-browser-idle.mjs";
import {
  BrowserPower,
  BrowserPowerSettings,
  BrowserUnavailableError,
  DEFAULT_IDLE_MINUTES,
  systemdBrowserUnits,
} from "./project-browser-power.mjs";

// A fake systemd and DevTools: `alive` is what answers, start/stop record their calls.
function fakeBrowsers({ startsAfterProbes = 1, failStart = false } = {}) {
  const alive = new Set();
  const calls = [];
  const probesLeft = new Map();
  const units = {
    async start(slug) {
      calls.push(["start", slug]);
      if (failStart) throw new Error("Access denied");
      probesLeft.set(slug, startsAfterProbes);
    },
    async stop(slug) {
      calls.push(["stop", slug]);
      alive.delete(slug);
    },
  };
  const ports = new Map([[19201, "vol"], [19202, "home"], [19203, "fam"]]);
  const probe = async (port) => {
    const slug = ports.get(port);
    if (probesLeft.has(slug)) {
      const left = probesLeft.get(slug) - 1;
      if (left <= 0) {
        probesLeft.delete(slug);
        alive.add(slug);
      } else probesLeft.set(slug, left);
    }
    return alive.has(slug);
  };
  return { alive, calls, units, probe };
}

test("systemd units: the target and its two units start by name, the target stops", async () => {
  const seen = [];
  const units = systemdBrowserUnits({ user: true, run: async (file, args) => seen.push([file, ...args]) });
  await units.start("vol");
  await units.stop("vol");
  assert.deepEqual(seen, [
    ["/usr/bin/systemctl", "--user", "--no-ask-password", "start",
      "volition-project-browser-kasm@vol.service", "volition-project-browser-chromium@vol.service",
      "volition-project-browser@vol.target"],
    ["/usr/bin/systemctl", "--user", "--no-ask-password", "stop", "volition-project-browser@vol.target"],
  ]);
  assert.throws(() => units.start("../etc"), /Invalid project browser/);
});

test("ensure starts a stopped browser once for concurrent callers and waits for DevTools", async () => {
  const browsers = fakeBrowsers({ startsAfterProbes: 3 });
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  await Promise.all([power.ensure("vol", 19201), power.ensure("vol", 19201), power.ensure("vol", 19201)]);
  assert.deepEqual(browsers.calls, [["start", "vol"]]);
  assert.equal(power.state("vol"), "running");
  await power.ensure("vol", 19201);
  assert.deepEqual(browsers.calls, [["start", "vol"]]);
});

test("a browser that already runs (a restarted router) is taken as running, not started", async () => {
  const browsers = fakeBrowsers();
  browsers.alive.add("home");
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  assert.equal(await power.observe("home", 19202), "running");
  await power.ensure("home", 19202);
  assert.deepEqual(browsers.calls, []);
  assert.equal(await power.observe("vol", 19201), "stopped");
});

test("a start that does not answer in time or is refused fails with a clear error", async () => {
  let time = 0;
  const slow = fakeBrowsers({ startsAfterProbes: 1_000 });
  const power = new BrowserPower({
    units: slow.units,
    probe: slow.probe,
    now: () => time,
    sleep: async (ms) => { time += ms; },
    startTimeoutMs: 2_000,
  });
  await assert.rejects(power.ensure("vol", 19201), (error) => error instanceof BrowserUnavailableError &&
    error.code === "BROWSER_UNAVAILABLE" && /did not start in time/.test(error.message));
  assert.equal(power.state("vol"), "stopped");

  const refused = fakeBrowsers({ failStart: true });
  const denied = new BrowserPower({ units: refused.units, probe: refused.probe, sleep: async () => {} });
  await assert.rejects(denied.ensure("vol", 19201), /could not be started/);
});

test("stop runs only while still idle, and a start waits for a stop in progress", async () => {
  const browsers = fakeBrowsers();
  browsers.alive.add("vol");
  let releaseStop;
  const units = {
    start: browsers.units.start,
    stop: async (slug) => {
      await new Promise((resolve) => { releaseStop = resolve; });
      return browsers.units.stop(slug);
    },
  };
  const power = new BrowserPower({ units, probe: browsers.probe, sleep: async () => {} });
  await power.observe("vol", 19201);
  assert.equal(await power.stop("vol", () => false), false);
  assert.equal(power.state("vol"), "running");

  const stopping = power.stop("vol");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(power.state("vol"), "stopping");
  const starting = power.ensure("vol", 19201);
  releaseStop();
  assert.equal(await stopping, true);
  await starting;
  assert.equal(power.state("vol"), "running");
  assert.deepEqual(browsers.calls, [["stop", "vol"], ["start", "vol"]]);
});

test("idle: a browser nobody uses is stopped after its stop time, one kept on is started", async () => {
  let time = 0;
  const browsers = fakeBrowsers();
  browsers.alive.add("vol");
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  const states = [];
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19201 }, { slug: "home", cdpPort: 19202 }],
    lifecycle: async (port, state) => { states.push([port, state]); return 1; },
    now: () => time,
    power,
    stopAfter: (slug) => (slug === "home" ? Infinity : 15 * 60_000),
  });

  await idle.poll();
  // Home is kept on ("immer an"): the poll starts it; VOL runs and is not due yet.
  assert.deepEqual(browsers.calls, [["start", "home"]]);
  assert.equal(power.state("home"), "running");

  time = 2 * 60_000;
  await idle.poll();
  assert.deepEqual(states.filter(([port]) => port === 19201), [[19201, "frozen"]]);

  time = 15 * 60_000;
  await idle.poll();
  assert.deepEqual(browsers.calls, [["start", "home"], ["stop", "vol"]]);
  assert.equal(power.state("vol"), "stopped");
  assert.equal(idle.running("vol"), false);

  // Further polls leave the stopped browser alone: no DevTools call, no start.
  const before = states.length;
  time = 60 * 60_000;
  await idle.poll();
  assert.equal(states.filter(([port]) => port === 19201).length, states.slice(0, before).filter(([port]) => port === 19201).length);
  assert.deepEqual(browsers.calls, [["start", "home"], ["stop", "vol"]]);
  // Home is never stopped.
  assert.equal(power.state("home"), "running");
});

test("idle: a viewer, a toolbar use or an agent's lock starts a stopped browser and keeps it", async () => {
  let time = 0;
  const browsers = fakeBrowsers();
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19201 }],
    lifecycle: async () => 1,
    now: () => time,
    power,
    stopAfter: () => 15 * 60_000,
  });
  await idle.poll();
  assert.equal(power.state("vol"), "stopped");
  assert.deepEqual(browsers.calls, []);

  const viewer = new EventEmitter();
  assert.equal(await idle.view("vol", 19201, viewer), true);
  assert.deepEqual(browsers.calls, [["start", "vol"]]);

  // Watched for an hour: never stopped.
  time = 60 * 60_000;
  await idle.poll();
  assert.equal(power.state("vol"), "running");

  // The viewer leaves: 15 minutes later it stops.
  viewer.emit("close");
  time += 14 * 60_000;
  await idle.poll();
  assert.equal(power.state("vol"), "running");
  time += 60_000;
  await idle.poll();
  assert.equal(power.state("vol"), "stopped");

  // An agent takes the lock: the browser starts, and is not stopped while it holds it.
  idle.lock("vol", { kind: "agent" });
  await idle.browsers.get("vol").queue;
  assert.equal(power.state("vol"), "running");
  time += 60 * 60_000;
  await idle.poll();
  assert.equal(power.state("vol"), "running");
  idle.lock("vol", null);
  time += 15 * 60_000;
  await idle.poll();
  assert.equal(power.state("vol"), "stopped");

  // A toolbar action or an agent's tool call (wake) starts it again.
  assert.equal(await idle.wake("vol"), true);
  assert.equal(power.state("vol"), "running");
  assert.deepEqual(browsers.calls.map(([verb]) => verb), ["start", "stop", "start", "stop", "start"]);
});

test("idle: a browser that does not start is reported, and the router's shutdown starts none", async () => {
  const browsers = fakeBrowsers({ failStart: true });
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19201 }],
    lifecycle: async () => 1,
    releaseVisibility: async () => { throw new Error("must not be called for a stopped browser"); },
    power,
    stopAfter: () => 15 * 60_000,
  });
  await idle.poll();
  assert.equal(await idle.wake("vol"), false);
  const calls = browsers.calls.length;
  await idle.stop();
  assert.equal(browsers.calls.length, calls);
});

test("settings: Helena's answer wins, is kept for the next start, and names who stays on", async () => {
  const directory = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "helena-power-"));
  try {
    const file = path.join(directory, "power.json");
    const defaults = new BrowserPowerSettings({ file, env: {} });
    assert.equal(defaults.current.idleMinutes, DEFAULT_IDLE_MINUTES);
    assert.equal(defaults.stopAfterMs("vol"), 15 * 60_000);
    assert.equal(await defaults.refresh(), false);

    const requests = [];
    const settings = new BrowserPowerSettings({
      file,
      env: { PROJECT_BROWSER_IDLE_MINUTES: "30", PROJECT_BROWSER_ALWAYS_ON: "fam" },
      apiUrl: "http://helena.test/",
      token: async () => "t".repeat(40),
      fetchImpl: async (url, init) => {
        requests.push([url, init.headers.authorization]);
        return { ok: true, json: async () => ({ idleMinutes: 5, alwaysOn: ["home", "../x", "home", "vol"] }) };
      },
    });
    assert.equal(settings.stopAfterMs("fam"), Infinity);
    assert.equal(settings.stopAfterMs("vol"), 30 * 60_000);
    assert.equal(await settings.refresh(), true);
    assert.deepEqual(requests, [["http://helena.test/internal/browser-gateway/power", `Bearer ${"t".repeat(40)}`]]);
    assert.deepEqual(settings.current, { idleMinutes: 5, alwaysOn: ["home", "vol"] });
    assert.equal(settings.stopAfterMs("vol"), Infinity);
    assert.equal(settings.stopAfterMs("fam"), 5 * 60_000);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

    const restarted = new BrowserPowerSettings({ file, env: {} });
    await restarted.load();
    assert.deepEqual(restarted.current, { idleMinutes: 5, alwaysOn: ["home", "vol"] });

    const never = new BrowserPowerSettings({ env: { PROJECT_BROWSER_IDLE_MINUTES: "0" } });
    assert.equal(never.stopAfterMs("vol"), Infinity);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a browser stopped behind the router's back is started again on its next use", async () => {
  let time = 0;
  const browsers = fakeBrowsers();
  browsers.alive.add("vol");
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, now: () => time, sleep: async () => {} });
  await power.observe("vol", 19201);
  assert.equal(power.state("vol"), "running");
  // Stopped by someone else (a deploy, an admin): the router still thinks it runs.
  browsers.alive.delete("vol");
  // Within the verification window a use trusts the state (no request per use)…
  time = 1_000;
  await power.ensure("vol", 19201);
  assert.deepEqual(browsers.calls, []);
  // …after it, the next use checks and starts the browser.
  time = 10_000;
  await power.ensure("vol", 19201);
  assert.deepEqual(browsers.calls, [["start", "vol"]]);
  assert.equal(power.state("vol"), "running");
});

test("idle: a freshly started browser is not woken page by page, and a failed use is checked again", async () => {
  const browsers = fakeBrowsers();
  const power = new BrowserPower({ units: browsers.units, probe: browsers.probe, sleep: async () => {} });
  const states = [];
  let failing = false;
  const idle = new BrowserIdle({
    listBrowsers: async () => [{ slug: "vol", cdpPort: 19201 }],
    lifecycle: async (_port, state) => {
      states.push(state);
      if (failing) throw new Error("Inspected target navigated or closed");
      return 1;
    },
    power,
    stopAfter: () => 15 * 60_000,
  });
  await idle.poll();
  assert.equal(await idle.wake("vol", { force: true }), true);
  assert.deepEqual(states, []);
  // Stopped behind the router's back while a use fails: the next use starts it again at once.
  browsers.alive.delete("vol");
  failing = true;
  assert.equal(await idle.wake("vol", { force: true }), false);
  failing = false;
  assert.equal(await idle.wake("vol", { force: true }), true);
  assert.deepEqual(browsers.calls, [["start", "vol"], ["start", "vol"]]);
});
