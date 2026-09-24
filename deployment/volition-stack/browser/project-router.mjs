import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  BrowserControlError,
  controlBrowser,
  listTabs,
  readJsonBody,
  startWindowKeeper,
} from "./project-browser-control.mjs";
import {
  joinScreencast,
  noteViewerAction,
  setViewportAuthority,
  viewportAuthority,
  watchDesktop,
} from "./project-browser-screencast.mjs";
import { acceptWebSocket } from "./websocket.mjs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ROUTE = /^\/projects\/([a-z0-9][a-z0-9-]{0,31})(\/.*)?$/;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

async function privateState(root, slug) {
  if (!path.isAbsolute(root) || !SLUG.test(slug)) throw new Error("Invalid browser route");
  const projectRoot = path.resolve(root, slug);
  const relative = path.relative(root, projectRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid browser route");
  const rootStat = await fs.lstat(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Invalid browser route");
  const statePath = path.join(projectRoot, "runtime.json");
  const stateStat = await fs.lstat(statePath);
  if (!stateStat.isFile() || stateStat.isSymbolicLink() || (stateStat.mode & 0o077) !== 0) {
    throw new Error("Invalid browser route");
  }
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  if (
    state.schemaVersion !== 1 ||
    state.slug !== slug ||
    !Number.isInteger(state.noVncPort) ||
    state.noVncPort < 1024 ||
    state.noVncPort > 65535 ||
    !Number.isInteger(state.cdpPort) ||
    state.cdpPort < 1024 ||
    state.cdpPort > 65535
  ) {
    throw new Error("Invalid browser route");
  }
  return { ...state, projectRoot };
}

// The X display a browser draws on and the cookie to reach it, for the live view's video, or
// null when the state does not name a display.
async function displayOf(state) {
  if (!Number.isInteger(state.display) || state.display < 0 || state.display > 65535) return null;
  const xauthority = path.join(state.projectRoot, "run", "Xauthority");
  try {
    const stat = await fs.lstat(xauthority);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return { display: state.display, xauthority };
}

export async function resolveProjectBrowser(root, requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  const match = ROUTE.exec(parsed.pathname);
  if (!match) throw new Error("Invalid browser route");
  const slug = match[1];
  const state = await privateState(root, slug);
  const pathname = match[2] || "/";
  return {
    slug,
    port: state.noVncPort,
    cdpPort: state.cdpPort,
    display: await displayOf(state),
    url: `${pathname}${parsed.search}`,
    api: pathname.startsWith("/api/") ? pathname.slice("/api/".length) : null,
  };
}

// Every project browser that has a valid runtime state, for the window keeper.
export async function listProjectBrowsers(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const browsers = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    try {
      const state = await privateState(root, entry.name);
      browsers.push({ slug: entry.name, cdpPort: state.cdpPort });
    } catch {
      // A project whose browser is being set up or removed has no valid state yet.
    }
  }
  return browsers;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

// Who decides a project browser's page size, for the browser gateway, which holds a working
// size while an agent steers: { mode: "follow" } or { mode: "fixed", width, height } (see
// setViewportAuthority in project-browser-screencast.mjs). size is optional.
export async function setProjectViewportAuthority(root, slug, mode, size) {
  const target = await resolveProjectBrowser(root, `/projects/${slug}/`);
  setViewportAuthority(target.cdpPort, mode, size);
  return viewportAuthority(target.cdpPort);
}

// The toolbar's routes: GET api/tabs lists the tabs, POST api/<action> acts on one; GET and
// POST api/viewport read and set who decides the page's size ({"mode":"fixed","width":1440,
// "height":900} or {"mode":"follow"}). Only a JSON body is accepted, which a form on another
// site cannot send.
async function handleControl(request, response, target) {
  try {
    if (target.api === "tabs" && request.method === "GET") {
      return sendJson(response, 200, { tabs: await listTabs(target.cdpPort) });
    }
    if (target.api === "viewport") {
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        const size = body.width === undefined ? undefined : { width: body.width, height: body.height };
        try {
          setViewportAuthority(target.cdpPort, body.mode, size);
        } catch (error) {
          throw new BrowserControlError(400, error.message);
        }
      } else if (request.method !== "GET") throw new BrowserControlError(405, "Method not allowed");
      return sendJson(response, 200, viewportAuthority(target.cdpPort));
    }
    if (request.method !== "POST") throw new BrowserControlError(405, "Method not allowed");
    const body = await readJsonBody(request);
    noteViewerAction(target.cdpPort);
    return sendJson(response, 200, await controlBrowser(target.cdpPort, target.api, body));
  } catch (error) {
    const status = error instanceof BrowserControlError ? error.status : 502;
    return sendJson(response, status, {
      error: error instanceof BrowserControlError ? error.message : "The browser did not answer",
    });
  }
}

export function isPrivateGatewayHeader(name) {
  const normalized = name.toLowerCase();
  return (
    normalized === "host" ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "proxy-authorization" ||
    normalized.startsWith("cf-") ||
    normalized.startsWith("x-forwarded-") ||
    normalized.startsWith("x-auth-") ||
    normalized.startsWith("x-volition-")
  );
}

// A WebSocket handshake from a page carries its origin; one from another site is refused.
export function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function proxyHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        value !== undefined && !HOP_HEADERS.has(name.toLowerCase()) && !isPrivateGatewayHeader(name),
    ),
  );
}

function refuse(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

// api/screencast is the live view's WebSocket; every other WebSocket is the display's.
async function handleUpgrade(root, request, socket, head) {
  // Node leaves an upgraded socket without an error listener, and an unhandled error ends
  // the process.
  socket.on("error", () => socket.destroy());
  let target;
  try {
    target = await resolveProjectBrowser(root, request.url || "/");
  } catch {
    return refuse(socket, "404 Not Found");
  }
  if (target.api !== null) {
    if (target.api !== "screencast") return refuse(socket, "404 Not Found");
    if (!isSameOrigin(request)) return refuse(socket, "403 Forbidden");
    const connection = acceptWebSocket(request, socket, head);
    if (connection) joinScreencast(target.cdpPort, target.display, connection);
    return;
  }
  watchDesktop(target.cdpPort, socket);
  const upstream = net.connect({ host: "127.0.0.1", port: target.port }, () => {
    const headers = Object.entries(request.headers)
      .filter(
        ([name, value]) =>
          value !== undefined && !isPrivateGatewayHeader(name) && name.toLowerCase() !== "host",
      )
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
    headers.push(`host: 127.0.0.1:${target.port}`);
    upstream.write(`${request.method} ${target.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

export function createProjectBrowserRouter(options = {}) {
  const root = options.root ?? "/var/lib/volition/project-browser/projects";
  const server = http.createServer(async (request, response) => {
    try {
      const target = await resolveProjectBrowser(root, request.url || "/");
      if (target.api !== null) return await handleControl(request, response, target);
      if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Method denied");
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: target.port,
          method: request.method,
          path: target.url,
          headers: { ...proxyHeaders(request.headers), host: `127.0.0.1:${target.port}` },
          timeout: 30_000,
        },
        (upstreamResponse) => {
          const headers = proxyHeaders(upstreamResponse.headers);
          headers["cache-control"] = "no-store";
          headers["x-content-type-options"] = "nosniff";
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          upstreamResponse.pipe(response);
        },
      );
      upstream.on("timeout", () => upstream.destroy(new Error("Browser unavailable")));
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502, { "cache-control": "no-store" });
        response.end("Browser unavailable");
      });
      request.pipe(upstream);
    } catch {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Browser unavailable");
    }
  });
  server.on("upgrade", (request, socket, head) => void handleUpgrade(root, request, socket, head));
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.PROJECT_BROWSER_ROUTER_PORT || 6082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid router port");
  const root = process.env.PROJECT_BROWSER_ROOT || "/var/lib/volition/project-browser/projects";
  const server = createProjectBrowserRouter({ root });
  const stopKeeper = startWindowKeeper({
    listBrowsers: () => listProjectBrowsers(root),
    log: (message) => console.log(message),
  });
  server.listen(port, "127.0.0.1", () => console.log("Project browser router ready on loopback"));
  process.on("SIGTERM", () => {
    stopKeeper();
    server.close(() => process.exit(0));
  });
}
