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
    viewportAuthority("vol", { kind: "agent", agentId: 1, agentName: "Coder" }, { width: 1280, height: 800 }, set);
    viewportAuthority("vol", { kind: "agent", agentId: 1, agentName: "Coder" }, undefined, set);
    viewportAuthority("vol", { kind: "owner" }, { width: 1280, height: 800 }, set);
    viewportAuthority("vol", null, undefined, set);
    assert.deepEqual(calls, [
      ["vol", "fixed", { width: 1280, height: 800 }],
      ["vol", "fixed", { width: 1440, height: 900 }],
      ["vol", "follow"],
      ["vol", "follow"],
    ]);
  });

  it("is a no-op without the live view's controller, and never throws from it", () => {
    viewportAuthority("vol", null, undefined, undefined);
    viewportAuthority("vol", null, undefined, () => {
      throw new Error("boom");
    });
    viewportAuthority("vol", null, undefined, () => Promise.reject(new Error("later")));
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
