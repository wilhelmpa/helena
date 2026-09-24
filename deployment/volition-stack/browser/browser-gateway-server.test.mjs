import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { groupId, LiveSessions, socketDirectory, viewportAuthority } from "./browser-gateway-server.mjs";

describe("browser gateway glue", () => {
  it("keeps each project's socket in a directory of its own, and refuses a slug that is a path", () => {
    assert.equal(socketDirectory("vol", "/run/x"), "/run/x/vol");
    assert.equal(socketDirectory("home", "/run/x"), "/run/x/home");
    for (const slug of ["../vol", "a/b", "", "-x", "Vol"]) assert.throws(() => socketDirectory(slug, "/run/x"));
  });

  it("reads a group's id from the group file, null when there is none", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-group-"));
    const file = path.join(dir, "group");
    await fs.writeFile(file, "root:x:0:\nvolition-agents:x:991:vp-vol,vp-fam\n");
    assert.equal(await groupId("volition-agents", file), 991);
    assert.equal(await groupId("missing", file), null);
    await fs.rm(dir, { recursive: true });
  });

  it("gives an agent in control the project's fixed working size, everyone else the panel", () => {
    const calls = [];
    const set = (...args) => calls.push(args);
    viewportAuthority(9301, { kind: "agent", agentId: 1, agentName: "Coder" }, { width: 1280, height: 800 }, set);
    viewportAuthority(9301, { kind: "agent", agentId: 1, agentName: "Coder" }, undefined, set);
    viewportAuthority(9301, { kind: "owner" }, { width: 1280, height: 800 }, set);
    viewportAuthority(9301, null, undefined, set);
    viewportAuthority(undefined, null, undefined, set);
    assert.deepEqual(calls, [
      [9301, "fixed", { width: 1280, height: 800 }, "Coder"],
      [9301, "fixed", { width: 1440, height: 900 }, "Coder"],
      [9301, "follow"],
      [9301, "follow"],
    ]);
  });

  it("never throws from the live view's controller", () => {
    viewportAuthority(9301, null, undefined, () => {
      throw new Error("boom");
    });
    viewportAuthority(9301, { kind: "agent", agentId: 1, agentName: "x".repeat(99) }, { width: 1, height: 1 }, () => {
      throw new Error("Invalid viewport size");
    });
  });

  it("drives the live view's real viewport authority for the browser's port", async () => {
    const { viewportAuthority: current } = await import("./project-browser-screencast.mjs");
    viewportAuthority(9302, { kind: "agent", agentId: 2, agentName: "Writer" }, { width: 1280, height: 800 });
    assert.deepEqual(current(9302), { mode: "fixed", width: 1280, height: 800, holder: "Writer" });
    viewportAuthority(9302, { kind: "owner" }, undefined);
    assert.deepEqual(current(9302), { mode: "follow" });
  });

  it("connects a project browser once for concurrent callers and again once it went away", async () => {
    let connects = 0;
    const session = { connected: true, isConnected() { return this.connected; } };
    const sessions = new LiveSessions(async () => 19201, async () => {
      connects++;
      await new Promise((r) => setTimeout(r, 10));
      return session;
    });
    const [a, b] = await Promise.all([sessions.get("vol"), sessions.get("vol")]);
    assert.equal(a, b);
    assert.equal(connects, 1);
    session.connected = false;
    await sessions.get("vol");
    assert.equal(connects, 2);
    await assert.rejects(new LiveSessions(async () => undefined, async () => session).get("x"), /No project browser/);
  });
});
