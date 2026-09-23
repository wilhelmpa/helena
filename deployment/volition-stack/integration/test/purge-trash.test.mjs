import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { purgeTrash } from "../purge-trash.mjs";

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-trash-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function entry(eventId, receipt) {
  const directory = path.join(root, eventId);
  await fs.mkdir(path.join(directory, "workspace"), { recursive: true });
  await fs.writeFile(path.join(directory, "workspace", "notes.md"), "kept until expiry");
  if (receipt) await fs.writeFile(path.join(directory, "receipt.json"), JSON.stringify({ eventId, ...receipt }));
}

it("deletes only the entries whose receipt has expired", async () => {
  const now = Date.parse("2026-10-30T00:00:00.000Z");
  const expired = "123e4567-e89b-42d3-a456-426614174000";
  const current = "223e4567-e89b-42d3-a456-426614174001";
  const unfinished = "323e4567-e89b-42d3-a456-426614174002";
  const mismatched = "423e4567-e89b-42d3-a456-426614174003";
  await entry(expired, { purgeAfter: "2026-10-29T00:00:00.000Z" });
  await entry(current, { purgeAfter: "2026-10-31T00:00:00.000Z" });
  await entry(unfinished, null);
  await fs.mkdir(path.join(root, mismatched));
  await fs.writeFile(
    path.join(root, mismatched, "receipt.json"),
    JSON.stringify({ eventId: expired, purgeAfter: "2026-10-01T00:00:00.000Z" }),
  );
  await fs.mkdir(path.join(root, "not-an-event"));

  assert.deepEqual(await purgeTrash(root, now), { purged: [expired], failed: [] });
  assert.deepEqual((await fs.readdir(root)).sort(), [current, unfinished, mismatched, "not-an-event"].sort());
});

it("treats a missing trash root as empty", async () => {
  assert.deepEqual(await purgeTrash(path.join(root, "missing")), { purged: [], failed: [] });
});
