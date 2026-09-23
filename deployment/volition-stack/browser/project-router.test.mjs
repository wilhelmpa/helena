import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createProjectBrowserRouter,
  isPrivateGatewayHeader,
  resolveProjectBrowser,
} from "./project-router.mjs";

let root;
let upstream;
let router;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-router-"));
});

afterEach(async () => {
  router?.closeAllConnections?.();
  upstream?.closeAllConnections?.();
  await Promise.all(
    [router, upstream].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await fs.rm(root, { recursive: true, force: true });
  router = null;
  upstream = null;
});

async function state(slug, port) {
  const directory = path.join(root, slug);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify({ schemaVersion: 1, slug, noVncPort: port }),
    { mode: 0o600 },
  );
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

describe("project browser router", () => {
  it("classifies browser credentials as private for HTTP and WebSocket forwarding", () => {
    assert.equal(isPrivateGatewayHeader("Cookie"), true);
    assert.equal(isPrivateGatewayHeader("Authorization"), true);
    assert.equal(isPrivateGatewayHeader("Proxy-Authorization"), true);
  });

  it("routes only a registered project and strips its private prefix", async () => {
    let seen = "";
    let seenSecret;
    let seenAuthorization;
    let seenCookie;
    upstream = http.createServer((request, response) => {
      seen = request.url;
      seenSecret = request.headers["x-volition-secret"];
      seenAuthorization = request.headers.authorization;
      seenCookie = request.headers.cookie;
      response.end("browser");
    });
    const upstreamPort = await listen(upstream);
    await state("demo", upstreamPort);
    router = createProjectBrowserRouter({ root });
    const routerPort = await listen(router);

    const response = await fetch(`http://127.0.0.1:${routerPort}/projects/demo/vnc.html?resize=scale`, {
      headers: {
        authorization: "Bearer must-not-reach-browser",
        connection: "close",
        cookie: "better-auth.session_token=must-not-reach-browser",
        "x-volition-secret": "must-not-reach-browser",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "browser");
    assert.equal(seen, "/vnc.html?resize=scale");
    assert.equal(seenSecret, undefined);
    assert.equal(seenAuthorization, undefined);
    assert.equal(seenCookie, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const missing = await fetch(`http://127.0.0.1:${routerPort}/projects/other/vnc.html`, {
      headers: { connection: "close" },
    });
    assert.equal(missing.status, 404);
  });

  it("rejects traversal, symlinked state and out-of-range upstreams", async () => {
    await assert.rejects(resolveProjectBrowser(root, "/projects/../demo/vnc.html"));
    await state("demo", 80);
    await assert.rejects(resolveProjectBrowser(root, "/projects/demo/vnc.html"));
    await fs.rm(path.join(root, "demo/runtime.json"));
    await fs.writeFile(path.join(root, "foreign"), "{}", { mode: 0o600 });
    await fs.symlink(path.join(root, "foreign"), path.join(root, "demo/runtime.json"));
    await assert.rejects(resolveProjectBrowser(root, "/projects/demo/vnc.html"));
  });
});
