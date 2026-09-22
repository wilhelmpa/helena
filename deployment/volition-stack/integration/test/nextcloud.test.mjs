import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createNextcloudClient } from "../nextcloud.mjs";

let temporaryRoot;
let passwordFile;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "volition-nextcloud-"),
  );
  passwordFile = path.join(temporaryRoot, "app-password");
  await fs.writeFile(passwordFile, "test-only-password\n", { mode: 0o600 });
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

function config() {
  return {
    filesUrl: "https://cloud.example.com/apps/files/files",
    nextcloudInternalUrl: "http://127.0.0.1:8092/",
    nextcloudHost: "cloud.example.com",
    nextcloudUser: "owner@example.com",
    nextcloudPasswordFile: passwordFile,
  };
}

describe("createNextcloudClient", () => {
  it("creates an idempotent folder and verifies it before returning a resource", async () => {
    const calls = [];
    const statuses = [201, 405, 201, 405, 201, 207, 207, 207, 207];
    const client = createNextcloudClient(config(), {
      fetch: async (url, options) => {
        calls.push({ url: url.toString(), options });
        return { status: statuses.shift() };
      },
    });

    const result = await client.ensureProjectFolder("demo");

    assert.deepEqual(
      calls.map(({ options }) => options.method),
      ["MKCOL", "MKCOL", "MKCOL", "MKCOL", "MKCOL", "PROPFIND", "PROPFIND", "PROPFIND", "PROPFIND"],
    );
    assert.equal(calls[0].options.headers.Host, "cloud.example.com");
    assert.equal(calls[5].options.headers.Depth, "0");
    assert.equal(
      new URL(calls[1].url).pathname,
      "/remote.php/dav/files/owner%40example.com/Projects/demo",
    );
    assert.deepEqual(
      calls.slice(2, 5).map(({ url }) => decodeURIComponent(new URL(url).pathname).split("/").at(-1)),
      ["Dokumente", "Ergebnisse", "Archiv"],
    );
    assert.equal(
      calls[0].options.headers.Authorization,
      `Basic ${Buffer.from("owner@example.com:test-only-password").toString("base64")}`,
    );
    assert.deepEqual(result, {
      kind: "files",
      id: "/Projects/demo",
      url: "https://cloud.example.com/apps/files/files?dir=%2FProjects%2Fdemo",
    });
  });

  it("does not return a resource when the exact folder cannot be verified", async () => {
    const statuses = [405, 405, 405, 405, 405, 207, 207, 404];
    const client = createNextcloudClient(config(), {
      fetch: async () => ({ status: statuses.shift() }),
    });

    await assert.rejects(
      client.ensureProjectFolder("demo"),
      /Nextcloud PROPFIND failed with HTTP 404/,
    );
  });

  it("rejects a password file readable by other users", async () => {
    await fs.chmod(passwordFile, 0o644);
    const client = createNextcloudClient(config(), {
      fetch: async () => ({ status: 201 }),
    });

    await assert.rejects(
      client.ensureProjectFolder("demo"),
      /must be a private regular file/,
    );
  });
});
