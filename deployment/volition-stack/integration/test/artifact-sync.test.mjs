import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createArtifactSyncService, ArtifactSyncValidationError } from "../artifact-sync.mjs";

function response(status, body = "", headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return new Response(bytes, { status, headers });
}

function config() {
  return {
    nextcloudInternalUrl: "http://127.0.0.1:8092/",
    nextcloudHost: "cloud.example.com",
    nextcloudUser: "owner@example.com",
    nextcloudPassword: "private-nextcloud-password",
    filesUrl: "https://cloud.example.com/apps/files/files",
    planInternalUrl: "http://127.0.0.1:3000/",
    planPublicUrl: "https://plan.example.com/",
    planApiKey: "private-plan-key",
    artifactSyncStatePath: "/private/artifact-sync.json",
  };
}

function sources(url) {
  const path = url.pathname;
  if (path === "/projects/DEMO/documents" && url.searchParams.get("archived") !== "true") {
    return response(200, [{ id: 4, version: 2, title: "Plan notes", archivedAt: null }]);
  }
  if (path === "/projects/DEMO/documents" && url.searchParams.get("archived") === "true") return response(200, []);
  if (path === "/projects/DEMO/documents/4/export") return response(200, { filename: "Plan notes.md", content: "# Notes\n", version: 2, exportedAt: "2026-09-21T00:00:00Z" });
  if (path === "/projects/DEMO/documents/4/issues") return response(200, [{ identifier: "DEMO-12", sequenceNumber: 12, title: "Check" }]);
  return null;
}

describe("artifact sync", () => {
  it("dry-runs all sources without mutating Nextcloud or local state", async () => {
    const calls = [];
    let wrote = false;
    const service = createArtifactSyncService(config(), {
      fetch: async (value, init = {}) => {
        const url = new URL(value);
        calls.push({ url, method: init.method || "GET" });
        const source = sources(url);
        if (source) return source;
        throw new Error("Unexpected Nextcloud request during dry-run");
      },
      readJson: async () => ({ schemaVersion: 1, projects: {} }),
      writeJsonAtomic: async () => { wrote = true; },
    });
    const result = await service.sync({ projectKey: "demo", dryRun: true });
    assert.equal(result.artifactCount, 1);
    assert.ok(result.actions.every((item) => item.action === "planned"));
    assert.equal(calls.some((item) => ["PUT", "MKCOL", "DELETE"].includes(item.method)), false);
    assert.equal(wrote, false);
  });

  it("writes immutable versioned files, exact private links and a manifest without deleting sources", async () => {
    const calls = [];
    let fileId = 40;
    let saved;
    const service = createArtifactSyncService(config(), {
      fetch: async (value, init = {}) => {
        const url = new URL(value);
        const method = init.method || "GET";
        calls.push({ url, method, headers: init.headers });
        const source = sources(url);
        if (source) return source;
        if (method === "MKCOL") return response(405);
        if (method === "PUT") return response(201);
        if (method === "PROPFIND") return response(207, `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:fileid>${fileId++}</oc:fileid><d:getetag>&quot;etag&quot;</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`);
        throw new Error(`Unexpected ${method} ${url}`);
      },
      readJson: async () => ({ schemaVersion: 1, projects: {} }),
      writeJsonAtomic: async (_path, value) => { saved = value; },
    });
    const result = await service.sync({ projectKey: "demo", dryRun: false });
    assert.equal(result.artifactCount, 1);
    assert.ok(result.actions.every((item) => item.action === "created"));
    assert.ok(result.actions.every((item) => /^https:\/\/cloud\.example\.com\/f\/\d+$/.test(item.link)));
    assert.ok(result.actions.some((item) => item.path.includes("/Dokumente/Plan/")));
    assert.equal(calls.some((item) => item.method === "DELETE"), false);
    assert.ok(calls.filter((item) => item.method === "PUT").every((item) => item.headers["If-None-Match"] === "*"));
    assert.ok(calls.filter((item) => item.url.pathname.startsWith("/projects/DEMO/")).every((item) => item.headers["x-api-key"] === "private-plan-key" && !item.headers.Authorization));
    const plan = Object.values(saved.projects.demo.artifacts).find((item) => item.source === "plan");
    assert.equal(plan.metadata.documentUrl, "https://plan.example.com/project/DEMO/docs/4");
    assert.equal(plan.metadata.issueLinks[0].url, "https://plan.example.com/project/DEMO/issue/12");
    assert.ok(result.manifest.link.startsWith("https://cloud.example.com/f/"));
  });

  it("rejects unsafe project keys before reading any source", async () => {
    const service = createArtifactSyncService(config(), { fetch: async () => { throw new Error("must not run"); } });
    await assert.rejects(() => service.sync({ projectKey: "../escape", dryRun: true }), ArtifactSyncValidationError);
  });

  it("does not write local state when a dry-run source read fails", async () => {
    let wrote = false;
    const service = createArtifactSyncService(config(), {
      fetch: async () => response(503),
      readJson: async () => ({ schemaVersion: 1, projects: {} }),
      writeJsonAtomic: async () => { wrote = true; },
    });
    await assert.rejects(() => service.sync({ projectKey: "demo", dryRun: true }), /HTTP 503/);
    assert.equal(wrote, false);
  });

  it("reuses unchanged fingerprints without downloading source or Nextcloud files", async () => {
    let saved;
    let nextcloudFileId = 70;
    const first = createArtifactSyncService(config(), {
      fetch: async (value, init = {}) => {
        const url = new URL(value);
        const source = sources(url);
        if (source) return source;
        if (init.method === "MKCOL") return response(405);
        if (init.method === "PUT") return response(201);
        if (init.method === "PROPFIND") return response(207, `<oc:fileid xmlns:oc="http://owncloud.org/ns">${nextcloudFileId++}</oc:fileid>`);
        throw new Error(`Unexpected ${init.method || "GET"} ${url}`);
      },
      readJson: async () => ({ schemaVersion: 1, projects: {} }),
      writeJsonAtomic: async (_path, value) => { saved = value; },
    });
    await first.sync({ projectKey: "demo", dryRun: false });

    let binaryDownloads = 0;
    let destinationRequests = 0;
    const second = createArtifactSyncService(config(), {
      fetch: async (value, init = {}) => {
        const url = new URL(value);
        if (url.pathname.includes("/download/") || url.pathname.endsWith("/export")) binaryDownloads += 1;
        if (url.pathname.startsWith("/remote.php/dav/")) destinationRequests += 1;
        const source = sources(url);
        if (source) return source;
        throw new Error(`Unexpected ${init.method || "GET"} ${url}`);
      },
      readJson: async () => saved,
      writeJsonAtomic: async (_path, value) => { saved = value; },
    });
    const result = await second.sync({ projectKey: "demo", dryRun: false });
    assert.equal(binaryDownloads, 0);
    assert.equal(destinationRequests, 0);
    assert.ok(result.actions.every((item) => item.action === "unchanged"));
  });

  it("does not request the removed document archive service", async () => {
    let archiveRequested = false;
    const service = createArtifactSyncService(config(), {
      fetch: async (value, init = {}) => {
        const url = new URL(value);
        if (url.pathname.startsWith("/api/documents")) archiveRequested = true;
        const source = sources(url);
        if (source) return source;
        throw new Error(`Unexpected ${init.method || "GET"} ${url}`);
      },
      readJson: async () => ({ schemaVersion: 1, projects: {} }),
      writeJsonAtomic: async () => {},
    });
    const result = await service.sync({ projectKey: "demo", dryRun: true });
    assert.equal(archiveRequested, false);
    assert.equal(result.artifactCount, 1);
  });
});
