import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProjectFilesValidationError,
  createProjectFilesService,
  parseDavListing,
  safeProjectFilePath,
} from "../project-files.mjs";

const config = {
  nextcloudInternalUrl: "http://127.0.0.1:8092/",
  nextcloudHost: "cloud.example.com",
  nextcloudUser: "owner@example.com",
  nextcloudPassword: "private-password",
};

describe("project files bridge", () => {
  it("rejects traversal, absolute paths, commands, and non-text create targets", () => {
    for (const value of [
      "../secret",
      "/etc/passwd",
      "folder\\secret",
      "folder//file",
    ]) {
      assert.throws(
        () => safeProjectFilePath(value),
        ProjectFilesValidationError,
      );
    }
    assert.throws(
      () => safeProjectFilePath("report.pdf", { textFile: true }),
      /Only .txt/,
    );
    assert.equal(
      safeProjectFilePath("notes/readme.md", { textFile: true }).normalized,
      "notes/readme.md",
    );
  });

  it("parses only direct descendants within the project folder", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/remote.php/dav/files/owner%40example.com/Projects/demo/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/remote.php/dav/files/owner%40example.com/Projects/demo/Notes/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Mon, 21 Sep 2026 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
        <d:response><d:href>/remote.php/dav/files/owner%40example.com/Projects/demo/readme.md</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength><d:getcontenttype>text/markdown</d:getcontenttype><d:getetag>&quot;file-etag&quot;</d:getetag></d:prop></d:propstat></d:response>
      </d:multistatus>`;
    assert.deepEqual(
      parseDavListing(
        xml,
        "/remote.php/dav/files/owner%40example.com/Projects/demo",
      ),
      [
        {
          name: "Notes",
          path: "Notes",
          kind: "folder",
          sizeBytes: null,
          contentType: null,
          updatedAt: "2026-09-21T10:00:00.000Z",
          etag: null,
          previewable: false,
        },
        {
          name: "readme.md",
          path: "readme.md",
          kind: "file",
          sizeBytes: 12,
          contentType: "text/markdown",
          updatedAt: null,
          etag: '"file-etag"',
          previewable: true,
        },
      ],
    );
  });

  it("rejects unsafe names returned by the storage backend", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/owner%40example.com/Projects/demo/bad%5Cname</d:href></d:response></d:multistatus>`;
    assert.throws(
      () =>
        parseDavListing(
          xml,
          "/remote.php/dav/files/owner%40example.com/Projects/demo",
        ),
      /invalid file path/,
    );
  });

  it("creates text only once and keeps credentials on the internal request", async () => {
    const calls = [];
    const service = createProjectFilesService(config, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 201 });
      },
    });
    assert.deepEqual(
      await service.createText({
        project: "demo",
        path: "Notes/decision.md",
        content: "# Decision",
      }),
      { project: "demo", path: "Notes/decision.md", created: true },
    );
    assert.equal(new URL(calls[0].url).origin, "http://127.0.0.1:8092");
    assert.equal(calls[0].init.headers["If-None-Match"], "*");
    assert.match(calls[0].init.headers.Authorization, /^Basic /);
  });

  it("upserts managed Markdown with idempotent folders and If-Match", async () => {
    const calls = [];
    const service = createProjectFilesService(config, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (init.method === "MKCOL") return new Response(null, { status: 405 });
        if (init.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { ETag: '"old-etag"' },
          });
        }
        return new Response(null, {
          status: 204,
          headers: { ETag: '"new-etag"' },
        });
      },
    });
    assert.deepEqual(
      await service.upsertText({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        content: "# Decision",
      }),
      {
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        created: false,
        etag: '"new-etag"',
      },
    );
    assert.deepEqual(
      calls.slice(0, 3).map((call) => [call.init.method, new URL(call.url).pathname]),
      [
        ["MKCOL", "/remote.php/dav/files/owner%40example.com/Projects/demo"],
        ["MKCOL", "/remote.php/dav/files/owner%40example.com/Projects/demo/Dokumente"],
        ["MKCOL", "/remote.php/dav/files/owner%40example.com/Projects/demo/Dokumente/Plan"],
      ],
    );
    assert.equal(calls[4].init.headers["If-Match"], '"old-etag"');
  });

  it("creates managed Markdown with If-None-Match when absence is expected", async () => {
    const calls = [];
    const service = createProjectFilesService(config, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (init.method === "MKCOL") return new Response(null, { status: 405 });
        return new Response(null, {
          status: 201,
          headers: { ETag: '"created-etag"' },
        });
      },
    });
    assert.deepEqual(
      await service.upsertText({
        project: "demo",
        path: "Dokumente/Plan/doc-2.md",
        content: "# Public document",
        expectedEtag: null,
      }),
      {
        project: "demo",
        path: "Dokumente/Plan/doc-2.md",
        created: true,
        etag: '"created-etag"',
      },
    );
    assert.equal(calls.at(-1).init.headers["If-None-Match"], "*");
    assert.equal(calls.some((call) => call.init.method === "HEAD"), false);
  });

  it("rejects managed mutations outside Dokumente/Plan", async () => {
    const service = createProjectFilesService(config, {
      fetch: async () => {
        throw new Error("unexpected request");
      },
    });
    await assert.rejects(
      service.upsertText({
        project: "demo",
        path: "private/doc-1.md",
        content: "private",
      }),
      /Dokumente\/Plan/,
    );
    await assert.rejects(
      service.deleteText({ project: "demo", path: "Dokumente/Plan/file.txt" }),
      /Dokumente\/Plan/,
    );
    await assert.rejects(
      service.deleteText({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        expectedEtag: '"valid"\r\nX-Injected: true',
      }),
      /expected ETag is invalid/,
    );
  });

  it("maps conditional write conflicts to a stable error code", async () => {
    const service = createProjectFilesService(config, {
      fetch: async (_url, init) =>
        new Response(null, { status: init.method === "MKCOL" ? 405 : 412 }),
    });
    await assert.rejects(
      service.upsertText({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        content: "changed",
        expectedEtag: '"old-etag"',
      }),
      (error) => error.status === 409 && error.code === "etag_conflict",
    );
  });

  it("deletes managed Markdown idempotently with If-Match", async () => {
    const calls = [];
    const service = createProjectFilesService(config, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (init.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { ETag: '"delete-etag"' },
          });
        }
        return new Response(null, { status: 204 });
      },
    });
    assert.deepEqual(
      await service.deleteText({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
      }),
      {
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        deleted: true,
      },
    );
    assert.equal(calls[1].init.headers["If-Match"], '"delete-etag"');

    const missingCalls = [];
    const missing = createProjectFilesService(config, {
      fetch: async (_url, init) => {
        missingCalls.push(init);
        return new Response(null, { status: 404 });
      },
    });
    assert.deepEqual(
      await missing.deleteText({
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        expectedEtag: '"already-gone"',
      }),
      {
        project: "demo",
        path: "Dokumente/Plan/doc-1.md",
        deleted: false,
      },
    );
    assert.equal(missingCalls[0].method, "DELETE");
  });

  it("moves managed Markdown without overwriting the destination", async () => {
    const calls = [];
    const service = createProjectFilesService(config, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (init.method === "MKCOL") return new Response(null, { status: 405 });
        return new Response(null, { status: 201 });
      },
    });
    assert.deepEqual(
      await service.moveText({
        project: "demo",
        fromPath: "Dokumente/Plan/doc-1.md",
        toPath: "Dokumente/Plan/archive/doc-1.md",
        expectedEtag: '"move-etag"',
      }),
      {
        project: "demo",
        fromPath: "Dokumente/Plan/doc-1.md",
        toPath: "Dokumente/Plan/archive/doc-1.md",
        moved: true,
      },
    );
    const move = calls.at(-1);
    assert.equal(move.init.method, "MOVE");
    assert.equal(move.init.headers["If-Match"], '"move-etag"');
    assert.equal(move.init.headers.Overwrite, "F");
    assert.equal(
      move.init.headers.Destination,
      "https://cloud.example.com/remote.php/dav/files/owner%40example.com/Projects/demo/Dokumente/Plan/archive/doc-1.md",
    );
  });
});
