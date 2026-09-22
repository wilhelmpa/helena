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
        <d:response><d:href>/remote.php/dav/files/owner%40example.com/Projects/demo/readme.md</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength><d:getcontenttype>text/markdown</d:getcontenttype></d:prop></d:propstat></d:response>
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
          previewable: false,
        },
        {
          name: "readme.md",
          path: "readme.md",
          kind: "file",
          sizeBytes: 12,
          contentType: "text/markdown",
          updatedAt: null,
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
});
