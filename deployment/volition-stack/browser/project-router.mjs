import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

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
    state.noVncPort > 65535
  ) {
    throw new Error("Invalid browser route");
  }
  return state;
}

export async function resolveProjectBrowser(root, requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  const match = ROUTE.exec(parsed.pathname);
  if (!match) throw new Error("Invalid browser route");
  const slug = match[1];
  const state = await privateState(root, slug);
  const pathname = match[2] || "/";
  return { slug, port: state.noVncPort, url: `${pathname}${parsed.search}` };
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

function proxyHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        value !== undefined && !HOP_HEADERS.has(name.toLowerCase()) && !isPrivateGatewayHeader(name),
    ),
  );
}

export function createProjectBrowserRouter(options = {}) {
  const root = options.root ?? "/var/lib/volition/project-browser/projects";
  return http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Method denied");
      const target = await resolveProjectBrowser(root, request.url || "/");
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
}

if (import.meta.main) {
  const port = Number(process.env.PROJECT_BROWSER_ROUTER_PORT || 6082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid router port");
  const server = createProjectBrowserRouter({ root: process.env.PROJECT_BROWSER_ROOT });
  server.on("upgrade", async (request, socket, head) => {
    try {
      const target = await resolveProjectBrowser(
        process.env.PROJECT_BROWSER_ROOT || "/var/lib/volition/project-browser/projects",
        request.url || "/",
      );
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
    } catch {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    }
  });
  server.listen(port, "127.0.0.1", () => console.log("Project browser router ready on loopback"));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
