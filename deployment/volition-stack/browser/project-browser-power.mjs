// Project browsers on demand (docs/plan-lokal-halogen.md, Phase 6.1). A project browser — its
// KasmVNC display and its Chromium, volition-project-browser@<slug>.target — runs only while it
// is used: the router starts it when the live view opens, the toolbar or the desktop view asks
// for it, or an agent calls a browser tool (browser-gateway-server.mjs), and BrowserIdle
// (project-browser-idle.mjs) stops it once nobody watched or used it for the idle time
// (Helena → Einstellungen → Browser, 15 minutes by default). A project marked "immer an" is
// started and kept running.
//
// Stopping is systemd's own stop of the target: Chromium ends on SIGTERM like on a shutdown and
// keeps its session, and its unit starts it with --restore-last-session, so the tabs come back
// on the next start; logins stay in the profile. Only this router starts and stops the targets
// (a polkit rule lets its user do exactly that, ../native/systemd/61-helena-browser-on-demand.rules).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { readGatewayToken } from "./gateway-token.mjs";

export const DEFAULT_IDLE_MINUTES = 15;
// How long a start may take before the live view and the agent's tool call give up: the
// display is up in a moment, Chromium with a restored session in a few seconds.
export const START_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 1_000;
const PROBE_INTERVAL_MS = 250;
const SYSTEMCTL_TIMEOUT_MS = 60_000;
const SETTINGS_REFRESH_MS = 60_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class BrowserUnavailableError extends Error {
  constructor(message = "The project browser did not start in time. Try again in a moment.") {
    super(message);
    this.code = "BROWSER_UNAVAILABLE";
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Whether Chromium's DevTools answer on the port: the one sign a project browser is usable.
export async function probeCdp(port, fetchImpl = fetch) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = await response.json();
    return typeof body?.webSocketDebuggerUrl === "string";
  } catch {
    return false;
  }
}

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: SYSTEMCTL_TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `: ${String(stderr).trim().slice(0, 300)}` : ""}`;
        reject(error);
      } else resolve(stdout);
    });
  });
}

// The systemd side: start and stop one project browser. Its display and Chromium are started
// by name as well as its target, so one that ended while the target stayed active (Chromium
// past its restart limit) comes back; stopping the target stops both (PartOf=). `user` runs
// the user manager (a test bed without root); it never asks for a password (polkit decides).
export function systemdBrowserUnits({
  systemctl = "/usr/bin/systemctl",
  user = false,
  prefix = "volition-project-browser",
  run = runCommand,
} = {}) {
  const name = (slug) => {
    if (!SLUG.test(slug)) throw new Error("Invalid project browser");
    return slug;
  };
  const call = (verb, units) => run(systemctl, [...(user ? ["--user"] : []), "--no-ask-password", verb, ...units]);
  return {
    start: (slug) =>
      call("start", [`${prefix}-kasm@${name(slug)}.service`, `${prefix}-chromium@${slug}.service`, `${prefix}@${slug}.target`]),
    stop: (slug) => call("stop", [`${prefix}@${name(slug)}.target`]),
  };
}

// What runs, per project browser, and the one queue its starts and stops go through, so a
// start never overlaps a stop of the same browser. States: "unknown" (not probed yet, e.g.
// after the router restarted), "starting", "running", "stopping", "stopped".
export class BrowserPower {
  #browsers = new Map();

  constructor({
    units,
    probe = probeCdp,
    sleep: pause = sleep,
    now = Date.now,
    startTimeoutMs = START_TIMEOUT_MS,
    probeIntervalMs = PROBE_INTERVAL_MS,
    log = () => {},
  }) {
    if (!units || typeof units.start !== "function" || typeof units.stop !== "function") {
      throw new Error("Browser units are required");
    }
    this.units = units;
    this.probe = probe;
    this.pause = pause;
    this.now = now;
    this.startTimeoutMs = startTimeoutMs;
    this.probeIntervalMs = probeIntervalMs;
    this.log = log;
  }

  #entry(slug) {
    let entry = this.#browsers.get(slug);
    if (!entry) {
      entry = { state: "unknown", queue: Promise.resolve(), busy: 0, since: this.now() };
      this.#browsers.set(slug, entry);
    }
    return entry;
  }

  #set(entry, state) {
    if (entry.state !== state) entry.since = this.now();
    entry.state = state;
  }

  #enqueue(entry, operation) {
    entry.busy += 1;
    const run = entry.queue.then(operation);
    entry.queue = run.catch(() => {}).finally(() => {
      entry.busy -= 1;
    });
    return run;
  }

  state(slug) {
    return this.#browsers.get(slug)?.state ?? "unknown";
  }

  // Since when the browser is in its state (ms, from `now`).
  since(slug) {
    return this.#browsers.get(slug)?.since ?? null;
  }

  running(slug) {
    return this.state(slug) === "running";
  }

  // Probes a browser nobody is starting or stopping, for what runs after a router restart and
  // for a browser that died by itself. Resolves to its state.
  async observe(slug, port) {
    const entry = this.#entry(slug);
    if (entry.busy > 0) return entry.state;
    const alive = await this.probe(port);
    if (entry.busy > 0) return entry.state;
    this.#set(entry, alive ? "running" : "stopped");
    return entry.state;
  }

  // Resolves once the browser answers on its DevTools port, starting it if it does not;
  // rejects with BrowserUnavailableError when it does not within the start timeout.
  ensure(slug, port) {
    const entry = this.#entry(slug);
    if (entry.state === "running" && entry.busy === 0) return Promise.resolve();
    return this.#enqueue(entry, async () => {
      if (entry.state === "running") return;
      if (await this.probe(port)) {
        this.#set(entry, "running");
        return;
      }
      this.#set(entry, "starting");
      const started = this.now();
      try {
        await this.units.start(slug);
      } catch (error) {
        this.#set(entry, "stopped");
        this.log(`browser power: could not start ${slug}: ${error.message}`);
        throw new BrowserUnavailableError("The project browser could not be started.");
      }
      while (this.now() - started < this.startTimeoutMs) {
        if (await this.probe(port)) {
          this.#set(entry, "running");
          this.log(`browser power: started ${slug} in ${this.now() - started} ms`);
          return;
        }
        await this.pause(this.probeIntervalMs);
      }
      this.#set(entry, "stopped");
      this.log(`browser power: ${slug} did not answer within ${this.startTimeoutMs} ms`);
      throw new BrowserUnavailableError();
    });
  }

  // Stops a running browser, unless `stillIdle` says it has been used since the decision.
  // Resolves to whether it stopped it.
  stop(slug, stillIdle = () => true) {
    const entry = this.#entry(slug);
    return this.#enqueue(entry, async () => {
      if (entry.state === "stopped" || !stillIdle()) return false;
      this.#set(entry, "stopping");
      try {
        await this.units.stop(slug);
        this.log(`browser power: stopped ${slug} after it was idle`);
      } catch (error) {
        this.log(`browser power: could not stop ${slug}: ${error.message}`);
        this.#set(entry, "unknown");
        return false;
      }
      this.#set(entry, "stopped");
      return true;
    });
  }

  forget(slug) {
    const entry = this.#browsers.get(slug);
    if (entry && entry.busy === 0) this.#browsers.delete(slug);
  }
}

// The idle time and the projects kept running ("immer an"), from Helena
// (GET /internal/browser-gateway/power with the gateway's token), kept in the router's state
// directory so a router that starts while Helena is down knows them too. Without Helena and
// without a saved copy: PROJECT_BROWSER_IDLE_MINUTES (default 15; 0 never stops) and
// PROJECT_BROWSER_ALWAYS_ON (slugs, comma-separated).
export class BrowserPowerSettings {
  constructor({
    file = null,
    apiUrl = process.env.BROWSER_GATEWAY_API_URL || "http://127.0.0.1:3000",
    token = process.env.BROWSER_GATEWAY_TOKEN_FILE ? () => readGatewayToken() : null,
    fetchImpl = fetch,
    env = process.env,
    log = () => {},
  } = {}) {
    this.file = file;
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.timer = null;
    this.current = BrowserPowerSettings.normalize({
      idleMinutes: env.PROJECT_BROWSER_IDLE_MINUTES === undefined ? DEFAULT_IDLE_MINUTES : Number(env.PROJECT_BROWSER_IDLE_MINUTES),
      alwaysOn: (env.PROJECT_BROWSER_ALWAYS_ON ?? "").split(",").map((slug) => slug.trim()),
    });
  }

  static normalize(value) {
    const minutes = Number(value?.idleMinutes);
    const idleMinutes = Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : DEFAULT_IDLE_MINUTES;
    const alwaysOn = Array.isArray(value?.alwaysOn)
      ? [...new Set(value.alwaysOn.filter((slug) => typeof slug === "string" && SLUG.test(slug)))].sort()
      : [];
    return { idleMinutes, alwaysOn };
  }

  // How long a browser may stay unused before it is stopped, in ms; Infinity keeps it running.
  stopAfterMs(slug) {
    if (this.current.alwaysOn.includes(slug) || this.current.idleMinutes === 0) return Infinity;
    return this.current.idleMinutes * 60_000;
  }

  alwaysOn(slug) {
    return this.stopAfterMs(slug) === Infinity;
  }

  async load() {
    if (!this.file) return;
    try {
      this.current = BrowserPowerSettings.normalize(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") this.log(`browser power settings: ${error.message}`);
    }
  }

  async refresh() {
    if (!this.token) return false;
    const token = await this.token();
    const response = await this.fetchImpl(`${this.apiUrl}/internal/browser-gateway/power`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Helena answered ${response.status}`);
    const next = BrowserPowerSettings.normalize(await response.json());
    if (JSON.stringify(next) === JSON.stringify(this.current)) return false;
    this.current = next;
    if (this.file) {
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await fs.rename(temporary, this.file);
    }
    return true;
  }

  start(intervalMs = SETTINGS_REFRESH_MS) {
    const tick = () => this.refresh().catch((error) => this.log(`browser power settings: ${error.message}`));
    void tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}
