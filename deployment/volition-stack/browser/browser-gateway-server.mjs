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
//   <- {"ok": true, "content": "...", "image"?: {"data","mimeType"}} | {"ok": false, "error": "..."}
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
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
import * as browserControl from "./project-browser-control.mjs";
import * as screencast from "./project-browser-screencast.mjs";

const { setControlState, setHandover } = screencast;
const DEFAULT_AGENT_VIEWPORT = { width: 1440, height: 900 };

// Who owns the page size (docs/volition-design-browser-perfekt.md §3.2): while an agent
// controls the browser the page keeps a fixed working size (the project's setting) and the
// live view only scales it; the owner or nobody in control, the page follows the live view's
// panel. The viewport controller itself is the live view's (hub/browser-live-4,
// setViewportAuthority(slug, 'follow' | 'fixed', size?)); until it is there this is a no-op.
export function viewportAuthority(
  slug,
  holder,
  viewport,
  set = screencast.setViewportAuthority ?? browserControl.setViewportAuthority,
) {
  if (typeof set !== "function") return;
  try {
    const result =
      holder?.kind === "agent" ? set(slug, "fixed", viewport ?? DEFAULT_AGENT_VIEWPORT) : set(slug, "follow");
    if (result && typeof result.catch === "function") result.catch(() => {});
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

export function socketDirectory(slug, root = SOCKET_ROOT) {
  if (!SLUG.test(slug)) throw new Error("Invalid project slug");
  return path.join(root, slug);
}

async function readToken() {
  const tokenFile = process.env.BROWSER_GATEWAY_TOKEN_FILE;
  if (!tokenFile) throw new Error("BROWSER_GATEWAY_TOKEN_FILE is not set");
  const stat = await fs.lstat(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("browser gateway token file has the wrong permissions");
  }
  const token = (await fs.readFile(tokenFile, "utf8")).trim();
  if (token.length < 32) throw new Error("browser gateway token is too short");
  return token;
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
// browser went away.
export class LiveSessions {
  #sessions = new Map();
  #connecting = new Map();
  #cdpPortOf;
  #connect;

  constructor(cdpPortOf, connect) {
    this.#cdpPortOf = cdpPortOf;
    this.#connect = connect;
  }

  async get(slug) {
    const cached = this.#sessions.get(slug);
    if (cached?.isConnected()) return cached;
    this.#sessions.delete(slug);
    let pending = this.#connecting.get(slug);
    if (!pending) {
      pending = (async () => {
        const cdpPort = await this.#cdpPortOf(slug);
        if (!cdpPort) throw new Error(`No project browser for ${slug}`);
        const session = await this.#connect(slug, cdpPort);
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
        if (
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

async function bindSocket(slug, dispatcher, gid) {
  const directory = socketDirectory(slug);
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("socket directory is not a directory");
  await fs.chmod(directory, 0o750);
  if (gid !== null) await fs.chown(directory, -1, gid);
  const socketPath = path.join(directory, "gateway.sock");
  await fs.rm(socketPath, { force: true });
  const server = net.createServer((socket) => handleConnection(socket, dispatcher));
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
export async function startBrowserGateway({ listBrowsers, log = () => {} }) {
  const token = await readToken();
  const helena = new HelenaClient({ baseUrl: HELENA_URL, serviceToken: token });
  const locks = new ProjectBrowserLocks(120_000);
  const queue = new SlugQueue();
  const cdpPorts = new Map(); // slug -> cdpPort, refreshed on the same interval as sockets
  // The key of the agent that last acted on a browser: a download that browser makes is
  // filed as that agent's. And each project's working size for its agents.
  const actors = new Map();
  const viewports = new Map();
  const sessions = new LiveSessions(
    async (slug) => cdpPorts.get(slug),
    (slug, cdpPort) =>
      PatchrightGatewaySession.connect(`http://127.0.0.1:${cdpPort}`, {
        humanInput: true,
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
  );
  const servers = new Map(); // slug -> net.Server
  await fs.mkdir(SOCKET_ROOT, { recursive: true, mode: 0o711 });
  await fs.chmod(SOCKET_ROOT, 0o711);
  const gid = await groupId(SOCKET_GROUP);

  // Every change of a lock reaches the live view of that browser (the banner), and every
  // change made by the owner reaches the project's activity.
  locks.onChange((slug, state) => {
    const cdpPort = cdpPorts.get(slug);
    if (cdpPort) setControlState(cdpPort, { holder: state.holder, since: state.since });
    viewportAuthority(slug, state.holder, viewports.get(slug));
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
        onActor: (target, agentKey, settings) => {
          actors.set(target, agentKey);
          if (settings?.agentViewport) viewports.set(target, settings.agentViewport);
        },
      });
      try {
        servers.set(slug, await bindSocket(slug, dispatcher, gid));
        log(`browser gateway: listening for ${slug}`);
      } catch (error) {
        log(`browser gateway: could not listen for ${slug}: ${error.message}`);
      }
    }
    for (const [slug, server] of servers) {
      if (wanted.has(slug)) continue;
      server.close();
      servers.delete(slug);
      sessions.drop(slug);
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

  return {
    locks,
    home: HOME_SLUG,
    stop() {
      clearInterval(timer);
      for (const server of servers.values()) server.close();
    },
  };
}
