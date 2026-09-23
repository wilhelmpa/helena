import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createProvisioningServer } from "../server.mjs";
import { ProjectFilesValidationError } from "../project-files.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- inert test fixture
const CONNECTIONS_TOKEN = "connections-owner-token-0123456789abcdef";
const INBOX_TOKEN = "inbox-integration-token-0123456789abcdef";
let server;
let origin;

beforeEach(async () => {
  server = createProvisioningServer(
    {
      token: TOKEN,
      inboxAccounts: ["owner@example.com"],
      inboxIntegrationToken: INBOX_TOKEN,
      connectionsIntegrationToken: CONNECTIONS_TOKEN,
      mastraInboxToken: "mastra-inbox-token-0123456789abcdef0123456789",
      connectionsEnabled: true,
      nextcloudPassword: "nextcloud-password",
    },
    {
      provisioner: { provision: async () => ({}) },
      triage: {},
      connections: {
        snapshot: async () => ({
          checkedAt: "2026-09-21T00:00:00.000Z",
          items: [],
        }),
        action: async () => ({
          checkedAt: "2026-09-21T00:00:00.000Z",
          items: [],
        }),
      },
      theme: {
        apply: async ({ theme }) => ({
          theme,
          results: [
            { service: "hermes", status: "updated", attempts: 1 },
            { service: "code", status: "updated", attempts: 1 },
            { service: "nextcloud", status: "updated", attempts: 1 },
          ],
        }),
      },
      files: {
        list: async ({ project, path }) => ({ project, path, items: [] }),
        readText: async ({ project, path }) => ({
          project,
          path,
          content: "# File",
          sizeBytes: 6,
        }),
        createText: async ({ project, path }) => ({
          project,
          path,
          created: true,
        }),
        ensureFolder: async ({ project, path }) => ({
          project,
          path,
          created: false,
        }),
        upsertText: async ({ project, path, expectedEtag }) => {
          if (expectedEtag === '"conflict"') {
            throw new ProjectFilesValidationError(
              "The file changed since it was read",
              409,
              "etag_conflict",
            );
          }
          return { project, path, created: false, etag: '"updated"' };
        },
        deleteText: async ({ project, path }) => ({
          project,
          path,
          deleted: true,
        }),
        moveText: async ({ project, fromPath, toPath }) => ({
          project,
          fromPath,
          toPath,
          moved: true,
        }),
        download: async () => ({
          bytes: Buffer.from("file"),
          filename: "readme.md",
          contentType: "text/markdown",
        }),
      },
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => new Promise((resolve) => server.close(resolve)));

function request(path, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CONNECTIONS_TOKEN}`,
      ...(init.headers || {}),
    },
  });
}

it("refuses the inbox worker credential on owner connections routes", async () => {
  const response = await fetch(`${origin}/api/connections`, {
    headers: { Authorization: `Bearer ${INBOX_TOKEN}` },
  });
  assert.equal(response.status, 401);
});

describe("communications routes", () => {
  it("protects connection inventory with the integration bearer", async () => {
    assert.equal((await fetch(`${origin}/api/connections`)).status, 401);
    const response = await request("/api/connections");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      checkedAt: "2026-09-21T00:00:00.000Z",
      items: [],
    });
  });

  it("accepts only a bounded theme with the owner integration bearer", async () => {
    assert.equal(
      (
        await fetch(`${origin}/api/theme`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: "dark" }),
        })
      ).status,
      401,
    );
    const response = await request("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).theme, "dark");
  });

  it("keeps project files behind the owner integration bearer", async () => {
    assert.equal(
      (
        await fetch(origin + "/api/files/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: "demo", path: "" }),
        })
      ).status,
      401,
    );
    const list = await request("/api/files/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "demo", path: "" }),
    });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), {
      project: "demo",
      path: "",
      items: [],
    });

    const download = await request("/api/files/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "demo", path: "readme.md" }),
    });
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      download.headers.get("content-disposition"),
      'attachment; filename="readme.md"',
    );
    assert.equal(await download.text(), "file");
  });

  it("exposes conditional managed Markdown lifecycle routes", async () => {
    const headers = { "Content-Type": "application/json" };
    const upsert = await request("/api/files/upsert-text", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        content: "# Document",
        expectedEtag: '"current"',
      }),
    });
    assert.equal(upsert.status, 200);
    assert.deepEqual(await upsert.json(), {
      project: "demo",
      path: "Dokumente/Plan/doc-1.md",
      created: false,
      etag: '"updated"',
    });

    const conflict = await request("/api/files/upsert-text", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        content: "changed",
        expectedEtag: '"conflict"',
      }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "etag_conflict");

    const deleted = await request("/api/files/delete", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
      }),
    });
    assert.deepEqual(await deleted.json(), {
      project: "demo",
      path: "Dokumente/Plan/doc-1.md",
      deleted: true,
    });

    const moved = await request("/api/files/move", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: "demo",
        fromPath: "Dokumente/Plan/doc-1.md",
        toPath: "Dokumente/Plan/archive/doc-1.md",
      }),
    });
    assert.deepEqual(await moved.json(), {
      project: "demo",
      fromPath: "Dokumente/Plan/doc-1.md",
      toPath: "Dokumente/Plan/archive/doc-1.md",
      moved: true,
    });
  });
});
