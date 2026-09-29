// The browser gateway's own process wiring (design §3): runs inside the browser router
// process (project-router.mjs starts it when BROWSER_GATEWAY_TOKEN_FILE is set), as the
// user `volition-browser` once agent isolation is on. It listens on one Unix socket per
// project browser, in a directory of its own:
//
//   /run/volition-browser/gateway/<slug>/gateway.sock      (Home: <slug> = home)
//
// The isolation launcher binds exactly that one directory into an agent's unit, at
// /run/volition-agents/browser, so the project a connection belongs to is the socket that
// accepted it — the kernel decides it, never the caller. A directory rather than the socket
// file itself is bound so a router restart, which creates the socket anew, still reaches
// agents that are already running. The directory is 0750 and its socket 0660, group
// `volition-agents` (the project users) when that group exists; without isolation both
// stay the router's own, which is then the runner's user.
//
// Wire protocol, one JSON line in, one JSON line out, per connection (see
// packages/browser-gateway/src/shim-protocol.ts, the stdio side of this same contract):
//   -> {"tool": "browser_navigate", "args": {...}, "agentKey": "...", "runId"?, "messageId"?,
//       "uploads"?: [{"name","mimeType","data"}, …]}
//   <- {"ok": true, "content": "...", "image"?: {"data","mimeType"}} | {"ok": false, "error": "...", "state"?}
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
// A relative import into the package's own source, not the bare "@repo/browser-gateway"
// specifier: this directory is plain deployment code, not a bun workspace member, so
// nothing links node_modules/@repo/browser-gateway here. The package's own node_modules
// (packages/browser-gateway/node_modules) still resolve patchright-core from there, because
// Node resolves a package's bare imports relative to that file's real location. Node 24
// strips the TypeScript natively; no build step.
import {
  GatewayDispatcher,
  HOME_SLUG,
  PatchrightGatewaySession,
  HelenaClient,
  ProjectBrowserLocks,
  SlugQueue,
} from "../../../packages/browser-gateway/src/index.ts";
import { readGatewayToken } from "./gateway-token.mjs";
import * as screencast from "./project-browser-screencast.mjs";

const { setControlState, setHandover, setNavigationState } = screencast;
const DEFAULT_AGENT_VIEWPORT = { width: 1440, height: 900 };

// Who owns the page size (docs/volition-design-browser-perfekt.md §3.2): while an agent
// controls the browser the page keeps a fixed working size (the project's setting, named
// after the agent) and the live view only scales it; with the owner or nobody in control the
// page follows the live view (setViewportAuthority, project-browser-screencast.mjs).
export function viewportAuthority(cdpPort, holder, viewport, set = screencast.setViewportAuthority) {
  if (!cdpPort || typeof set !== "function") return;
  try {
    if (holder?.kind === "agent") {
      set(cdpPort, "fixed", viewport ?? DEFAULT_AGENT_VIEWPORT, String(holder.agentName ?? "").slice(0, 64) || undefined);
    } else {
      set(cdpPort, "follow");
    }
  } catch {
    // The live view's controller failing never touches the lock.
  }
}

const SOCKET_ROOT = process.env.BROWSER_GATEWAY_SOCKET_ROOT || "/run/volition-browser/gateway";
const SOCKET_GROUP = process.env.BROWSER_GATEWAY_SOCKET_GROUP || "volition-agents";
const HELENA_URL = process.env.BROWSER_GATEWAY_API_URL || "http://127.0.0.1:3000";
const REFRESH_MS = 5_000;
// A browser_file_upload carries its files (at most 50 MB together) base64-encoded in its one line.
const MAX_REQUEST_BYTES = 72 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
// jev-browser's throwaway browser in Browser 2.0 (packages/browser-gateway/src/jev-browser-lab.ts).
const JEV_BROWSER_LAB = fileURLToPath(new URL("../../../packages/browser-gateway/src/jev-browser-lab.ts", import.meta.url));
const JEV_BROWSER_CHROMIUM = process.env.HELENA_JEV_BROWSER_CHROMIUM || "/usr/bin/chromium";
const MAX_JEV_BROWSER_RUNS = 2;

export function socketDirectory(slug, root = SOCKET_ROOT) {
  if (!SLUG.test(slug)) throw new Error("Invalid project slug");
  return path.join(root, slug);
}

// The group id of a group by name, from /etc/group; null when it does not exist.
export async function groupId(name, groupFile = "/etc/group") {
  const content = await fs.readFile(groupFile, "utf8").catch(() => "");
  for (const line of content.split("\n")) {
    const [group, , gid] = line.split(":");
    if (group === name && /^\d+$/.test(gid ?? "")) return Number(gid);
  }
  return null;
}

// One long-lived patchright connection per project browser, reused across tool calls (a
// fresh connectOverCDP per call would lose the session's SecretGuard, the one place the
// secrets it typed are remembered for redaction, design §6), and connected again when the
// browser went away. `ensure(slug, cdpPort)` runs first on every call: with project browsers
// on demand it starts a stopped browser (and waits for it, within its start timeout) and
// counts the call as a use, so the browser is not stopped under an agent.
export class LiveSessions {
  #sessions = new Map();
  #connecting = new Map();
  #cdpPortOf;
  #connect;
  #ensure;

  constructor(cdpPortOf, connect, ensure = async () => {}) {
    this.#cdpPortOf = cdpPortOf;
    this.#connect = connect;
    this.#ensure = ensure;
  }

  async get(slug) {
    const port = await this.#cdpPortOf(slug);
    if (!port) throw new Error(`No project browser for ${slug}`);
    await this.#ensure(slug, port);
    const cached = this.#sessions.get(slug);
    if (cached?.isConnected()) return cached;
    this.#sessions.delete(slug);
    let pending = this.#connecting.get(slug);
    if (!pending) {
      pending = (async () => {
        const session = await this.#connect(slug, port);
        this.#sessions.set(slug, session);
        return session;
      })().finally(() => this.#connecting.delete(slug));
      this.#connecting.set(slug, pending);
    }
    return pending;
  }

  drop(slug) {
    this.#sessions.delete(slug);
  }
}

export function handleConnection(socket, dispatcher) {
  const chunks = [];
  let size = 0;
  let done = false;
  const answer = (response) => {
    if (done) return;
    done = true;
    socket.end(`${JSON.stringify(response)}\n`);
  };
  socket.on("data", (chunk) => {
    if (done) return;
    const newline = chunk.indexOf(0x0a);
    const part = newline === -1 ? chunk : chunk.subarray(0, newline);
    size += part.length;
    if (size > MAX_REQUEST_BYTES) return answer({ ok: false, error: "Request too large" });
    chunks.push(part);
    if (newline === -1) return;
    done = true;
    void (async () => {
      let response;
      try {
        const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        // The shim's tools/list: which tools this agent is offered here (browser_task only
        // where the project has a decision model).
        if (request && request.list === true && typeof request.agentKey === "string") {
          response = { ok: true, tools: await dispatcher.listTools(request.agentKey) };
        } else if (
          !request ||
          typeof request !== "object" ||
          typeof request.tool !== "string" ||
          typeof request.agentKey !== "string"
        ) {
          response = { ok: false, error: "Invalid request" };
        } else {
          response = await dispatcher.handle(request);
        }
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Internal error" };
      }
      socket.end(`${JSON.stringify(response)}\n`);
    })();
  });
  socket.on("error", () => socket.destroy());
}

// Closing a net.Server alone waits for an agent's open Unix connection. Keep the accepted
// sockets so router shutdown can terminate them without waiting for a stalled tool call.
const gatewaySockets = new WeakMap();

function closeGatewayServer(server) {
  server.close();
  for (const socket of gatewaySockets.get(server) ?? []) socket.destroy();
}

async function bindSocket(slug, dispatcher, gid) {
  const directory = socketDirectory(slug);
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("socket directory is not a directory");
  await fs.chmod(directory, 0o750);
  if (gid !== null) await fs.chown(directory, -1, gid);
  const socketPath = path.join(directory, "gateway.sock");
  await fs.rm(socketPath, { force: true });
  const clients = new Set();
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    handleConnection(socket, dispatcher);
  });
  gatewaySockets.set(server, clients);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  await fs.chmod(socketPath, 0o660);
  if (gid !== null) await fs.chown(socketPath, -1, gid);
  return server;
}

// Starts the browser gateway inside the router process. `listBrowsers` is
// project-router.mjs's listProjectBrowsers(root). Returns the lock registry (the live view's
// Übernehmen/Zurückgeben act on it) and stop().
export async function startBrowserGateway({ listBrowsers, ensureBrowser, log = () => {} }) {
  const token = await readGatewayToken();
  const helena = new HelenaClient({ baseUrl: HELENA_URL, serviceToken: token });
  const locks = new ProjectBrowserLocks(120_000);
  const queue = new SlugQueue();
  const cdpPorts = new Map(); // slug -> cdpPort, refreshed on the same interval as sockets
  // The key of the agent that last acted on a browser: a download that browser makes is
  // filed as that agent's. And each project's working size for its agents.
  const actors = new Map();
  const viewports = new Map();
  let previewPolicies;
  let previewPoliciesUntil = 0;
  function previewOrigins(slug) {
    if (!previewPolicies || Date.now() >= previewPoliciesUntil) {
      previewPoliciesUntil = Date.now() + 1000;
      previewPolicies = helena.policy().catch(() => ({}));
    }
    return previewPolicies.then((policies) => policies[slug]?.previewOrigins ?? []);
  }
  const sessions = new LiveSessions(
    async (slug) => cdpPorts.get(slug),
    (slug, cdpPort) =>
      PatchrightGatewaySession.connect(`http://127.0.0.1:${cdpPort}`, {
        humanInput: true,
        getPreviewOrigins: () => previewOrigins(slug),
        onDownload: async (fileName, bytes) => {
          const { path: saved } = await helena.download({
            projectSlug: slug,
            agentKey: actors.get(slug) ?? null,
            fileName,
            data: bytes.toString("base64"),
          });
          return saved;
        },
      }),
    ensureBrowser,
  );
  const servers = new Map(); // slug -> net.Server
  const dispatchers = new Map(); // slug -> GatewayDispatcher
  await fs.mkdir(SOCKET_ROOT, { recursive: true, mode: 0o711 });
  await fs.chmod(SOCKET_ROOT, 0o711);
  const gid = await groupId(SOCKET_GROUP);

  // Every change of a lock reaches the live view of that browser (the banner), and every
  // change made by the owner reaches the project's activity.
  locks.onChange((slug, state) => {
    const cdpPort = cdpPorts.get(slug);
    if (cdpPort) setControlState(cdpPort, { holder: state.holder, since: state.since });
    viewportAuthority(cdpPort, state.holder, viewports.get(slug));
  });

  function onHandover(slug, notice) {
    const cdpPort = cdpPorts.get(slug);
    if (cdpPort) setHandover(cdpPort, notice);
  }

  async function reconcile() {
    const browsers = await listBrowsers();
    const wanted = new Set(browsers.map((browser) => browser.slug));
    for (const browser of browsers) {
      const known = cdpPorts.has(browser.slug);
      cdpPorts.set(browser.slug, browser.cdpPort);
      // A browser the router just learned about starts with a known, free lock, so its
      // live view shows the lock's state rather than guessing from activity.
      if (!known) {
        const state = locks.of(browser.slug).state();
        setControlState(browser.cdpPort, { holder: state.holder, since: state.since });
      }
    }
    for (const slug of wanted) {
      if (servers.has(slug)) continue;
      const dispatcher = new GatewayDispatcher({
        ownSlug: slug,
        helena,
        locks,
        sessions,
        queue,
        onHandover,
        onNavigationState: (target, state) => {
          const cdpPort = cdpPorts.get(target);
          if (cdpPort) setNavigationState(cdpPort, state);
        },
        onActor: (target, agentKey, settings) => {
          actors.set(target, agentKey);
          if (settings?.agentViewport) viewports.set(target, settings.agentViewport);
        },
      });
      dispatchers.set(slug, dispatcher);
      try {
        servers.set(slug, await bindSocket(slug, dispatcher, gid));
        log(`browser gateway: listening for ${slug}`);
      } catch (error) {
        log(`browser gateway: could not listen for ${slug}: ${error.message}`);
      }
    }
    for (const [slug, server] of servers) {
      if (wanted.has(slug)) continue;
      closeGatewayServer(server);
      servers.delete(slug);
      dispatchers.delete(slug);
      sessions.drop(slug);
      const cdpPort = cdpPorts.get(slug);
      if (cdpPort) setNavigationState(cdpPort, null);
      cdpPorts.delete(slug);
      await fs.rm(socketDirectory(slug), { recursive: true, force: true }).catch(() => {});
      log(`browser gateway: stopped listening for ${slug} (no longer provisioned)`);
    }
  }

  await reconcile();
  const timer = setInterval(() => {
    locks.sweep();
    void reconcile().catch((error) => log(`browser gateway: ${error.message}`));
  }, REFRESH_MS);

  // Browser 2.0 (docs/helena-decisions/browser-task.md §3.5). A decision-model run is an ordinary
  // browser_task call made as the agent the owner chose: `labKey` ("lab:<token>") stands in for
  // that agent's key, and Helena maps it to the agent. A run the gateway refuses before it
  // starts (the owner holds the browser, the agent lacks the tool) is closed with the reason.
  const failRun = (taskToken, summary) =>
    helena.taskFinish({ taskToken, result: { status: "error", summary: String(summary).slice(0, 300) } }).catch(() => {});
  let jevRuns = 0;
  const tasks = {
    authorized(header) {
      const given = Buffer.from(typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "");
      const expected = Buffer.from(token);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
    async startLab(body) {
      const slug = typeof body?.slug === "string" ? body.slug : "";
      const labKey = typeof body?.labKey === "string" ? body.labKey : "";
      const dispatcher = dispatchers.get(slug);
      if (!dispatcher) throw new Error("No project browser for this project");
      if (!labKey.startsWith("lab:")) throw new Error("Invalid run");
      const args = body.args && typeof body.args === "object" ? body.args : {};
      void dispatcher
        .handle({ tool: "browser_task", args, agentKey: labKey })
        .then((response) => {
          if (!response.ok) void failRun(labKey.slice(4), response.error);
        })
        .catch((error) => void failRun(labKey.slice(4), error?.message ?? "failed"));
    },
    async startJevBrowser(body) {
      const slug = typeof body?.slug === "string" ? body.slug : "";
      const runToken = typeof body?.token === "string" ? body.token : "";
      if (!SLUG.test(slug) || runToken.length < 20) throw new Error("Invalid run");
      if (jevRuns >= MAX_JEV_BROWSER_RUNS) throw new Error("Two jev-browser runs are already going");
      const policies = await helena.policy().catch(() => ({}));
      const policy = policies[slug] ?? { domainAllowlist: [], domainBlocklist: [] };
      const startUrl = typeof body.startUrl === "string" && /^https?:\/\//i.test(body.startUrl) ? body.startUrl : "about:blank";
      jevRuns += 1;
      // A minimal environment: no service token, no path to one.
      const child = spawn(process.execPath, [JEV_BROWSER_LAB], {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "/tmp",
          TMPDIR: process.env.TMPDIR ?? "/tmp",
          LANG: "de_DE.UTF-8",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      // The last lines Chromium and jev-browser wrote to stderr: when the run ends without a
      // result, the first telling one goes into the run's summary (a Chromium that could not
      // start says why there, e.g. crashpad or the sandbox).
      let stderrTail = "";
      child.stderr.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4096);
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
      let finished = false;
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message?.type === "round") {
            void helena.taskProgress({ taskToken: runToken, step: message.step, usage: {} }).then(
              (answer) => {
                if (answer?.cancelled) child.kill("SIGTERM");
              },
              () => {},
            );
          } else if (message?.type === "result") {
            finished = true;
            void helena.taskFinish({ taskToken: runToken, result: message.result }).catch(() => {});
          }
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        jevRuns -= 1;
        if (!finished) {
          const telling = stderrTail
            .split("\n")
            .map((line) => line.replace(/^\[[\d:/.]+:[A-Z]+:[^\]]*\]\s*/, "").trim())
            .find((line) => /fatal|crashpad|sandbox|cannot|could not|error/i.test(line));
          void failRun(
            runToken,
            telling ? `jev-browser stopped without a result: ${telling.slice(0, 200)}` : "jev-browser stopped without a result",
          );
        }
      });
      child.stdin.end(
        `${JSON.stringify({
          apiUrl: `${HELENA_URL.replace(/\/+$/, "")}/internal/systemone`,
          token: runToken,
          model: typeof body.model === "string" ? body.model : "jev-latest",
          goal: String(body.goal ?? ""),
          values: body.values && typeof body.values === "object" ? body.values : {},
          startUrl,
          maxSteps: Number(body.maxSteps) || 10,
          allowIrreversible: body.allowIrreversible === true,
          chromium: JEV_BROWSER_CHROMIUM,
          domainAllowlist: policy.domainAllowlist ?? [],
          domainBlocklist: policy.domainBlocklist ?? [],
        })}\n`,
      );
    },
  };

  return {
    locks,
    tasks,
    previews: (slug) => helena.previews(slug),
    home: HOME_SLUG,
    stop() {
      clearInterval(timer);
      for (const server of servers.values()) closeGatewayServer(server);
    },
  };
}
