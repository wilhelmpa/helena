import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { movePath } from "../move-path.mjs";

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-move-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Fails the direct move the way rename(2) does between two mounts.
function acrossMounts(calls) {
  return async (source, destination) => {
    calls.push(path.basename(source));
    if (!source.endsWith(".partial")) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    return fs.rename(source, destination);
  };
}

it("copies across mount points and keeps modes, links and timestamps", async () => {
  const source = path.join(root, "source");
  await fs.mkdir(path.join(source, "private"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(source, "private/notes.md"), "notes", { mode: 0o600 });
  await fs.symlink("private/notes.md", path.join(source, "link"));
  const past = new Date("2026-01-01T00:00:00.000Z");
  await fs.utimes(path.join(source, "private/notes.md"), past, past);
  const socket = net.createServer().listen(path.join(source, "private/agent.sock"));
  await new Promise((resolve) => socket.once("listening", resolve));
  const calls = [];
  try {
    await movePath(source, path.join(root, "destination"), { rename: acrossMounts(calls) });
  } finally {
    socket.close();
  }

  const destination = path.join(root, "destination");
  assert.deepEqual(calls, ["source", "destination.partial"]);
  await assert.rejects(fs.lstat(source), { code: "ENOENT" });
  await assert.rejects(fs.lstat(`${destination}.partial`), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(destination, "private/notes.md"), "utf8"), "notes");
  assert.equal((await fs.stat(path.join(destination, "private/notes.md"))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(destination, "private"))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(destination, "private/notes.md"))).mtime.getTime(), past.getTime());
  assert.equal(await fs.readlink(path.join(destination, "link")), "private/notes.md");
  await assert.rejects(fs.lstat(path.join(destination, "private/agent.sock")), { code: "ENOENT" });
});

it("replaces the copy an interrupted move left behind", async () => {
  const source = path.join(root, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "complete.md"), "complete");
  await fs.mkdir(path.join(root, "destination.partial"));
  await fs.writeFile(path.join(root, "destination.partial/stale.md"), "stale");

  await movePath(source, path.join(root, "destination"), { rename: acrossMounts([]) });

  assert.deepEqual(await fs.readdir(path.join(root, "destination")), ["complete.md"]);
});

it("moves with rename where the paths share a mount", async () => {
  const source = path.join(root, "registry.json");
  await fs.writeFile(source, "{}");
  await movePath(source, path.join(root, "moved.json"));
  assert.equal(await fs.readFile(path.join(root, "moved.json"), "utf8"), "{}");
});
