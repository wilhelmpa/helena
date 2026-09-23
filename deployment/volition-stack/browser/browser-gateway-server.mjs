// The browser gateway's own process wiring (design §3): runs inside the browser router
// process (started from project-router.mjs, see its own `if (import.meta.main)` block),
// as the user `volition-browser`. Listens on one Unix socket per project browser —
// /run/volition-browser/gateway-<slug>.sock, plus gateway-home.sock — never one shared
// socket (see deployment/volition-stack/isolation/README.md for why: the project an agent
// unit's socket connection belongs to has to come from which socket file the launcher bound
// into that unit, the same "the project comes from the kernel, not the client" rule
// shared/agent-socket.ts already applies to the Plan API). Each socket's own slug is fixed
// at listen time, so a connection accepted on gateway-mkt.sock can only ever act on "mkt"
// unless the caller is the Home-Master (checked by GatewayDispatcher itself, not here).
//
// Wire protocol, one JSON line in, one JSON line out, per connection (see
// browser-gateway-mcp-shim.mjs, the stdio side of this same contract):
//   -> {"tool": "browser_navigate", "args": {...}, "agentKey": "...", "runId"?, "messageId"?}
//   <- {"ok": true, "content": "..."} | {"ok": false, "error": "..."}
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { readFile, lstat } from "node:fs/promises";
// A relative import into the package's own source, not the bare "@repo/browser-gateway"
// specifier: this directory is plain deployment code, not a bun workspace member (it has
// no package.json and is outside the root workspaces globs), so nothing links
// node_modules/@repo/browser-gateway here the way bun links it for apps/api and friends.
// The package's OWN node_modules (packages/browser-gateway/node_modules) still resolves
// patchright-core and @modelcontextprotocol/sdk correctly from there, because Node resolves
// a package's bare imports relative to that package's own real file location, not to
// whichever file first imported it. Node 24 strips this file's TypeScript natively; no
// build step.
import {
  GatewayDispatcher,
  ProjectBrowserLocks,
  PatchrightGatewaySession,
  PlanClient,
  HOME_SLUG,
} from "../../../packages/browser-gateway/src/index.ts";
import { notifyControlHolder } from "./project-browser-screencast.mjs";

const SOCKET_DIR = process.env.BROWSER_GATEWAY_SOCKET_DIR || "/run/volition-browser";
const VAULT_ROOT = process.env.BROWSER_GATEWAY_VAULT_ROOT || "/var/lib/volition/vault/Projects";
const PLAN_URL = process.env.BROWSER_GATEWAY_PLAN_URL || "http://127.0.0.1:3000";
const REFRESH_MS = 5_000;

async function readToken() {
  const tokenFile = process.env.BROWSER_GATEWAY_TOKEN_FILE;
  if (!tokenFile) throw new Error("BROWSER_GATEWAY_TOKEN_FILE is not set");
  const stat = await lstat(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("browser gateway token file has the wrong permissions");
  }
  return (await readFile(tokenFile, "utf8")).trim();
}

// One long-lived patchright connection per project browser, reused across tool calls (a
// fresh connectOverCDP per call would mean a fresh page reference each time and would lose
// the session's own SecretGuard — the one place tracked secrets have to persist across
// calls, design §6). humanInput is re-applied from the latest resolved settings on every
// hand-out, since a project's own setting can change without restarting the gateway.
class LiveSessions {
  #sessions = new Map();
  #cdpPortOf;

  constructor(cdpPortOf) {
    this.#cdpPortOf = cdpPortOf;
  }

  async get(slug) {
    const cached = this.#sessions.get(slug);
    if (cached) return cached;
    const cdpPort = await this.#cdpPortOf(slug);
    if (!cdpPort) throw new Error(`No project browser for ${slug}`);
    const session = await PatchrightGatewaySession.connect(`http://127.0.0.1:${cdpPort}`, {
      vaultInbox: path.join(VAULT_ROOT, slug.toUpperCase(), "Inbox"),
      humanInput: true,
    });
    this.#sessions.set(slug, session);
    return session;
  }

  drop(slug) {
    this.#sessions.delete(slug);
  }
}

function handleConnection(socket, dispatcher) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline);
    buffer = "";
    void (async () => {
      let response;
      try {
        const request = JSON.parse(line);
        if (typeof request.tool !== "string" || typeof request.agentKey !== "string") {
          response = { ok: false, error: "Invalid request" };
        } else {
          response = await dispatcher.handle(request);
        }
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : "Internal error" };
      }
      socket.end(JSON.stringify(response) + "\n");
    })();
  });
  socket.on("error", () => socket.destroy());
}

async function bindSocket(socketPath, dispatcher) {
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
  return server;
}

// Starts (or keeps running) the browser gateway inside the router process. `listBrowsers`
// is project-router.mjs's own listProjectBrowsers(root); `root` names the same project-
// browser state directory the router already uses. Returns a stop() that closes every
// socket.
export async function startBrowserGateway({ listBrowsers, log = () => {} }) {
  const token = await readToken();
  const planClient = new PlanClient({ baseUrl: PLAN_URL, serviceToken: token });
  const locks = new ProjectBrowserLocks(120_000);
  const cdpPorts = new Map(); // slug -> cdpPort, refreshed on the same interval as sockets
  const sessions = new LiveSessions(async (slug) => cdpPorts.get(slug));
  const servers = new Map(); // slug -> {server, dispatcher}

  function notify(slug, holder) {
    const cdpPort = cdpPorts.get(slug);
    if (cdpPort) notifyControlHolder(cdpPort, holder);
  }

  async function reconcile() {
    const browsers = await listBrowsers();
    const wanted = new Set(browsers.map((b) => b.slug));
    wanted.add(HOME_SLUG);
    for (const browser of browsers) cdpPorts.set(browser.slug, browser.cdpPort);

    for (const slug of wanted) {
      if (servers.has(slug)) continue;
      const dispatcher = new GatewayDispatcher({ ownSlug: slug, planClient, locks, sessions, notify });
      try {
        const server = await bindSocket(path.join(SOCKET_DIR, `gateway-${slug}.sock`), dispatcher);
        servers.set(slug, server);
        log(`browser gateway: listening for ${slug}`);
      } catch (error) {
        log(`browser gateway: could not bind ${slug}: ${error.message}`);
      }
    }
    for (const [slug, server] of servers) {
      if (wanted.has(slug)) continue;
      server.close();
      servers.delete(slug);
      sessions.drop(slug);
      log(`browser gateway: stopped listening for ${slug} (no longer provisioned)`);
    }
  }

  await fs.mkdir(SOCKET_DIR, { recursive: true });
  await reconcile();
  const timer = setInterval(() => void reconcile(), REFRESH_MS);

  return {
    locks,
    stop() {
      clearInterval(timer);
      for (const server of servers.values()) server.close();
    },
  };
}
