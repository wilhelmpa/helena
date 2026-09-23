import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createProjectBrowserRouter,
  isPrivateGatewayHeader,
  listProjectBrowsers,
  resolveProjectBrowser,
} from "./project-router.mjs";
import { fittedBounds, navigableUrl, targetId } from "./project-browser-control.mjs";

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

async function state(slug, port, cdpPort = 19200) {
  const directory = path.join(root, slug);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify({ schemaVersion: 1, slug, noVncPort: port, cdpPort }),
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

  it("serves the tab list and toolbar actions from the project's DevTools endpoint", async () => {
    const seen = [];
    upstream = http.createServer((request, response) => {
      seen.push(`${request.method} ${request.url}`);
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/json/list") {
        response.end(
          JSON.stringify([
            { id: "A".repeat(32), type: "page", title: "Front", url: "https://a.test/" },
            { id: "B".repeat(32), type: "service_worker", title: "", url: "https://a.test/sw.js" },
            { id: "C".repeat(32), type: "page", title: "", url: "https://c.test/" },
          ]),
        );
      } else response.end("{}");
    });
    const cdpPort = await listen(upstream);
    await state("demo", 16000, cdpPort);
    router = createProjectBrowserRouter({ root });
    const base = `http://127.0.0.1:${await listen(router)}/projects/demo/api`;

    const tabs = await (await fetch(`${base}/tabs`)).json();
    assert.deepEqual(tabs, {
      tabs: [
        { id: "A".repeat(32), title: "Front", url: "https://a.test/", active: true },
        { id: "C".repeat(32), title: "https://c.test/", url: "https://c.test/", active: false },
      ],
    });

    const activated = await fetch(`${base}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "C".repeat(32) }),
    });
    assert.equal(activated.status, 200);
    assert.ok(seen.includes(`GET /json/activate/${"C".repeat(32)}`));

    // A form on another site cannot send JSON, so anything else is refused.
    const form = await fetch(`${base}/close`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `id=${"C".repeat(32)}`,
    });
    assert.equal(form.status, 415);
    const unknown = await fetch(`${base}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "../json/version" }),
    });
    assert.equal(unknown.status, 400);
    assert.equal((await fetch(`${base}/unknown`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  });

  it("lists the project browsers with a valid state for the window keeper", async () => {
    await state("demo", 16000, 19201);
    await fs.mkdir(path.join(root, "broken"), { mode: 0o700 });
    assert.deepEqual(await listProjectBrowsers(root), [{ slug: "demo", cdpPort: 19201 }]);
  });
});

describe("project browser control", () => {
  it("opens web addresses only", () => {
    assert.equal(navigableUrl("example.com/path"), "https://example.com/path");
    assert.equal(navigableUrl(" http://intranet.local "), "http://intranet.local/");
    assert.equal(navigableUrl("about:blank"), "about:blank");
    for (const refused of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", ""]) {
      assert.throws(() => navigableUrl(refused));
    }
  });

  it("accepts DevTools target ids only", () => {
    assert.equal(targetId("E9FA2045DECEE97DB2160D8A482371FF"), "E9FA2045DECEE97DB2160D8A482371FF");
    assert.throws(() => targetId("../json/version"));
  });

  it("fits a window to its screen unless it already fills it", () => {
    const screen = { width: 1280, height: 800 };
    assert.equal(
      fittedBounds({ windowState: "normal", left: 0, top: 0, width: 1280, height: 800 }, screen),
      null,
    );
    assert.deepEqual(
      fittedBounds({ windowState: "normal", left: 10, top: 10, width: 1920, height: 1080 }, screen),
      { left: 0, top: 0, width: 1280, height: 800 },
    );
    assert.deepEqual(
      fittedBounds({ windowState: "maximized", left: 0, top: 0, width: 1280, height: 800 }, screen),
      { left: 0, top: 0, width: 1280, height: 800 },
    );
    assert.equal(fittedBounds({ windowState: "normal" }, { width: 0, height: 0 }), null);
  });
});
