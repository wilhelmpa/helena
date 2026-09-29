import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BrowserControlError,
  CdpConnection,
  controlBrowser,
  navigableUrl,
} from "./project-browser-control.mjs";

describe("browser address input", () => {
  it("uses HTTP for explicit schemeless loopback ports without rewriting aliases", () => {
    for (const [input, expected] of [
      ["127.0.0.1:24032", "http://127.0.0.1:24032/"],
      ["127.0.0.2:4321", "http://127.0.0.2:4321/"],
      [" localhost:24032/path?q=1#part ", "http://localhost:24032/path?q=1#part"],
      ["LOCALHOST:4321", "http://localhost:4321/"],
      ["[::1]:24032", "http://[::1]:24032/"],
      ["[0:0:0:0:0:0:0:1]:4321/path", "http://[::1]:4321/path"],
      ["http://127.0.0.1:24032/", "http://127.0.0.1:24032/"],
      ["https://localhost:4321/", "https://localhost:4321/"],
    ]) {
      assert.equal(navigableUrl(input), expected, input);
    }
  });

  it("keeps public addresses on HTTPS and does not infer local reachability", () => {
    for (const [input, expected] of [
      ["example.com/path", "https://example.com/path"],
      ["192.0.2.1:4321/path", "https://192.0.2.1:4321/path"],
      ["[2001:db8::1]:4321/path", "https://[2001:db8::1]:4321/path"],
      ["127.0.0.1.example.com/path", "https://127.0.0.1.example.com/path"],
      ["http://example.com/path", "http://example.com/path"],
      ["about:blank", "about:blank"],
    ]) {
      assert.equal(navigableUrl(input), expected, input);
    }
  });

  it("rejects invalid ports, ambiguous IPv6, userinfo and non-web protocols", () => {
    for (const input of [
      "localhost:", "localhost:-1", "localhost:12x", "localhost:65536",
      "127.0.0.1:abc", "127.0.0.1:65536", "127.999.0.1:4321",
      "[::1]:abc", "[::1]:65536", "::1:4321",
      "localhost:4321@evil.example", "127.0.0.1:4321@evil.example",
      "https://user:password@example.com/", "http://user@127.0.0.1:24032/",
      "javascript:alert(1)", "javascript:123", "file:///etc/passwd", "chrome://version",
      "data:text/html,example", "", " ", "a".repeat(4097),
    ]) {
      assert.throws(
        () => navigableUrl(input),
        (error) => error instanceof BrowserControlError && error.status === 400,
        input,
      );
    }
  });
});

describe("browser navigation result", () => {
  const id = "0123456789ABCDEF";
  function devtools(t, result) {
    const commands = [];
    let closed = false;
    t.mock.method(globalThis, "fetch", async () =>
      Response.json([{ id, webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fixture" }]),
    );
    t.mock.method(CdpConnection, "open", async () => ({
      async send(method, params) {
        commands.push({ method, params });
        return result;
      },
      close() {
        closed = true;
      },
    }));
    return { commands, closed: () => closed };
  }

  it("reports a CDP navigation failure instead of success", async (t) => {
    const fixture = devtools(t, { errorText: "net::ERR_BLOCKED_BY_CLIENT" });
    await assert.rejects(
      controlBrowser(9222, "navigate", { id, url: "127.0.0.1:24032" }),
      (error) =>
        error instanceof BrowserControlError && error.status === 502 &&
        error.message === "Navigation failed: net::ERR_BLOCKED_BY_CLIENT",
    );
    // A failed navigation leaves the tab on about:blank instead of Chrome's error page (126).
    assert.deepEqual(fixture.commands, [
      { method: "Page.navigate", params: { url: "http://127.0.0.1:24032/" } },
      { method: "Page.navigate", params: { url: "about:blank" } },
    ]);
    assert.equal(fixture.closed(), true);
  });

  it("preserves successful navigation and closes the control connection", async (t) => {
    const fixture = devtools(t, { frameId: "fixture" });
    assert.deepEqual(await controlBrowser(9222, "navigate", { id, url: "example.com" }), { ok: true });
    assert.deepEqual(fixture.commands, [{
      method: "Page.navigate", params: { url: "https://example.com/" },
    }]);
    assert.equal(fixture.closed(), true);
  });
});
