import path from "node:path";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MAX_LIST_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 500;
const PLAN_DOCUMENT_ROOT = ["Dokumente", "Plan"];

export class ProjectFilesValidationError extends Error {
  constructor(message, status = 400, code = "invalid_request") {
    super(message);
    this.name = "ProjectFilesValidationError";
    this.status = status;
    this.code = code;
  }
}

function projectSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new ProjectFilesValidationError("The project file scope is invalid");
  }
  return value;
}

export function safeProjectFilePath(value = "", { textFile = false } = {}) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 1024 ||
    value.startsWith("/")
  ) {
    throw new ProjectFilesValidationError("The file path is invalid");
  }
  const parts = value === "" ? [] : value.split("/");
  if (
    parts.length > 20 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > 255 ||
        part.split("").some((character) => {
          const code = character.charCodeAt(0);
          return code <= 0x1f || code === 0x7f || character.charCodeAt(0) === 0x5c;
        }),
    )
  ) {
    throw new ProjectFilesValidationError("The file path is invalid");
  }
  const normalized = parts.join("/");
  if (
    textFile &&
    (!normalized ||
      !TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase()))
  ) {
    throw new ProjectFilesValidationError(
      "Only .txt, .md, and .markdown files are allowed",
    );
  }
  return { normalized, parts };
}

function safePlanMarkdownPath(value) {
  const safe = safeProjectFilePath(value, { textFile: true });
  if (
    safe.parts.length < 3 ||
    !PLAN_DOCUMENT_ROOT.every((part, index) => safe.parts[index] === part) ||
    ![".md", ".markdown"].includes(
      path.extname(safe.normalized).toLowerCase(),
    )
  ) {
    throw new ProjectFilesValidationError(
      "Managed Markdown files must be stored below Dokumente/Plan",
    );
  }
  return safe;
}

function xmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(block, name) {
  const pattern = new RegExp(
    "<(?:[\\w.-]+:)?" +
      name +
      "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" +
      name +
      ">",
    "i",
  );
  const match = block.match(pattern);
  return match ? xmlText(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function hasCollection(block) {
  return /<(?:[\w.-]+:)?collection(?:\s[^>]*)?\/?>/i.test(block);
}

function parseModified(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseDavListing(xml, basePath, currentPath = "") {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_LIST_BYTES) {
    throw new ProjectFilesValidationError(
      "The folder listing is too large",
      502,
    );
  }
  const responses =
    xml.match(
      /<(?:[\w.-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?response>/gi,
    ) || [];
  const decodedRoot = decodeURIComponent(basePath.replace(/\/+$/, ""));
  const items = [];
  for (const block of responses) {
    const rawHref = tag(block, "href");
    if (!rawHref) continue;
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(rawHref, "http://nextcloud.invalid").pathname,
      ).replace(/\/+$/, "");
    } catch {
      throw new ProjectFilesValidationError(
        "Nextcloud returned an invalid file path",
        502,
      );
    }
    if (pathname === decodedRoot) continue;
    if (!pathname.startsWith(decodedRoot + "/")) {
      throw new ProjectFilesValidationError(
        "Nextcloud returned a path outside the project",
        502,
      );
    }
    const relative = pathname.slice(decodedRoot.length + 1);
    if (!relative || relative.includes("/")) continue;
    try {
      safeProjectFilePath([currentPath, relative].filter(Boolean).join("/"));
    } catch {
      throw new ProjectFilesValidationError(
        "Nextcloud returned an invalid file path",
        502,
      );
    }
    const directory = hasCollection(block);
    const size = Number(tag(block, "getcontentlength"));
    const etag = tag(block, "getetag");
    items.push({
      name: relative,
      path: [currentPath, relative].filter(Boolean).join("/"),
      kind: directory ? "folder" : "file",
      sizeBytes: directory || !Number.isFinite(size) ? null : size,
      contentType: directory
        ? null
        : tag(block, "getcontenttype") || "application/octet-stream",
      updatedAt: parseModified(tag(block, "getlastmodified")),
      etag: directory || !etag ? null : etag,
      previewable:
        !directory && TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()),
    });
    if (items.length > MAX_ITEMS) {
      throw new ProjectFilesValidationError(
        "The folder contains too many entries",
        413,
      );
    }
  }
  return items.sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name)
      : a.kind === "folder"
        ? -1
        : 1,
  );
}

function contentLength(response) {
  const value = Number(response.headers.get("content-length"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function responseEtag(response, required = false) {
  const value = response.headers.get("etag");
  if (!value && !required) return null;
  if (
    !value ||
    Buffer.byteLength(value) > 256 ||
    !/^"[\x21\x23-\x7e]+"$/.test(value)
  ) {
    throw new Error("Nextcloud returned an invalid ETag");
  }
  return value;
}

function expectedEtag(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 256 ||
    !/^"[\x21\x23-\x7e]+"$/.test(value)
  ) {
    throw new ProjectFilesValidationError("The expected ETag is invalid");
  }
  return value;
}

function textContent(relative, content) {
  const safe = safeProjectFilePath(relative, { textFile: true });
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content) > MAX_TEXT_BYTES
  ) {
    throw new ProjectFilesValidationError(
      "The text content is too large",
      413,
    );
  }
  return {
    safe,
    contentType:
      path.extname(safe.normalized).toLowerCase() === ".txt"
        ? "text/plain; charset=utf-8"
        : "text/markdown; charset=utf-8",
  };
}

export function createProjectFilesService(config, options = {}) {
  const request = options.fetch || fetch;
  const authorization =
    "Basic " +
    Buffer.from(config.nextcloudUser + ":" + config.nextcloudPassword).toString(
      "base64",
    );

  function dav(project, relative = "") {
    const slug = projectSlug(project);
    const safe = safeProjectFilePath(relative);
    const rootPath =
      "/remote.php/dav/files/" +
      encodeURIComponent(config.nextcloudUser) +
      "/Projects/" +
      encodeURIComponent(slug);
    const suffix = safe.parts.map(encodeURIComponent).join("/");
    return {
      basePath: rootPath,
      url: new URL(
        suffix ? rootPath + "/" + suffix : rootPath,
        config.nextcloudInternalUrl,
      ),
      safe,
    };
  }

  async function fetchDav(url, init) {
    return request(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: {
        Authorization: authorization,
        Host: config.nextcloudHost,
        ...(init.headers || {}),
      },
    });
  }

  async function ensureFolders(project, parts) {
    let created = false;
    for (let index = 0; index <= parts.length; index += 1) {
      const relative = parts.slice(0, index).join("/");
      const response = await fetchDav(dav(project, relative).url, {
        method: "MKCOL",
      });
      await response.body?.cancel();
      if (response.status === 201) created = true;
      else if (response.status !== 405) {
        throw new Error(
          "Nextcloud MKCOL failed with HTTP " + response.status,
        );
      }
    }
    return created;
  }

  async function currentEtag(target) {
    const response = await fetchDav(target, { method: "HEAD" });
    await response.body?.cancel();
    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw new Error("Nextcloud HEAD failed with HTTP " + response.status);
    }
    return responseEtag(response, true);
  }

  function conflict(message = "The file changed since it was read") {
    return new ProjectFilesValidationError(message, 409, "etag_conflict");
  }

  return {
    async list({ project, path: relative = "" }) {
      const target = dav(project, relative);
      const response = await fetchDav(target.url, {
        method: "PROPFIND",
        headers: {
          Depth: "1",
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: '<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>',
      });
      if (response.status === 404)
        throw new ProjectFilesValidationError("Folder not found", 404);
      if (response.status !== 207) {
        throw new Error(
          "Nextcloud PROPFIND failed with HTTP " + response.status,
        );
      }
      const declared = contentLength(response);
      if (declared !== null && declared > MAX_LIST_BYTES) {
        await response.body?.cancel();
        throw new ProjectFilesValidationError(
          "The folder listing is too large",
          413,
        );
      }
      return {
        project,
        path: target.safe.normalized,
        items: parseDavListing(
          await response.text(),
          target.url.pathname,
          target.safe.normalized,
        ),
      };
    },

    async readText({ project, path: relative }) {
      const safe = safeProjectFilePath(relative, { textFile: true });
      const response = await fetchDav(dav(project, safe.normalized).url, {
        method: "GET",
      });
      if (response.status === 404)
        throw new ProjectFilesValidationError("File not found", 404);
      if (response.status !== 200)
        throw new Error("Nextcloud GET failed with HTTP " + response.status);
      const declared = contentLength(response);
      if (declared !== null && declared > MAX_TEXT_BYTES) {
        await response.body?.cancel();
        throw new ProjectFilesValidationError(
          "The text file is too large",
          413,
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_TEXT_BYTES) {
        throw new ProjectFilesValidationError(
          "The text file is too large",
          413,
        );
      }
      return {
        project,
        path: safe.normalized,
        content: bytes.toString("utf8"),
        sizeBytes: bytes.length,
        etag: responseEtag(response),
      };
    },

    async createText({ project, path: relative, content }) {
      const { safe, contentType } = textContent(relative, content);
      const response = await fetchDav(dav(project, safe.normalized).url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "If-None-Match": "*",
        },
        body: content,
      });
      await response.body?.cancel();
      if (response.status === 412) {
        throw new ProjectFilesValidationError(
          "A file with this name already exists",
          409,
        );
      }
      if (response.status === 409) {
        throw new ProjectFilesValidationError(
          "The target folder does not exist",
          409,
        );
      }
      if (response.status !== 201) {
        throw new Error("Nextcloud PUT failed with HTTP " + response.status);
      }
      return { project, path: safe.normalized, created: true };
    },

    async ensureFolder({ project, path: relative = "" }) {
      const safe = safeProjectFilePath(relative);
      return {
        project,
        path: safe.normalized,
        created: await ensureFolders(project, safe.parts),
      };
    },

    async upsertText(input) {
      const { project, path: relative, content } = input || {};
      const safe = safePlanMarkdownPath(relative);
      const { contentType } = textContent(safe.normalized, content);
      await ensureFolders(project, safe.parts.slice(0, -1));

      const target = dav(project, safe.normalized).url;
      let matchHeader;
      let create;
      if (Object.prototype.hasOwnProperty.call(input, "expectedEtag")) {
        if (input.expectedEtag === null) {
          matchHeader = { "If-None-Match": "*" };
          create = true;
        } else {
          matchHeader = { "If-Match": expectedEtag(input.expectedEtag) };
          create = false;
        }
      } else {
        const current = await currentEtag(target);
        if (current === null) {
          matchHeader = { "If-None-Match": "*" };
          create = true;
        } else {
          matchHeader = { "If-Match": current };
          create = false;
        }
      }

      const response = await fetchDav(target, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          ...matchHeader,
        },
        body: content,
      });
      await response.body?.cancel();
      if (response.status === 412) {
        throw conflict();
      }
      if (response.status === 409) {
        throw new ProjectFilesValidationError(
          "The target folder does not exist",
          409,
        );
      }
      if (![200, 201, 204].includes(response.status)) {
        throw new Error("Nextcloud PUT failed with HTTP " + response.status);
      }
      return {
        project,
        path: safe.normalized,
        created: create,
        etag: responseEtag(response, true),
      };
    },

    async deleteText(input) {
      const { project, path: relative } = input || {};
      const safe = safePlanMarkdownPath(relative);
      const target = dav(project, safe.normalized).url;
      let etag;
      if (Object.prototype.hasOwnProperty.call(input, "expectedEtag")) {
        etag = expectedEtag(input.expectedEtag);
      } else {
        etag = await currentEtag(target);
        if (etag === null) {
          return { project, path: safe.normalized, deleted: false };
        }
      }
      const response = await fetchDav(target, {
        method: "DELETE",
        headers: { "If-Match": etag },
      });
      await response.body?.cancel();
      if (response.status === 404) {
        return { project, path: safe.normalized, deleted: false };
      }
      if (response.status === 412) throw conflict();
      if (![200, 204].includes(response.status)) {
        throw new Error(
          "Nextcloud DELETE failed with HTTP " + response.status,
        );
      }
      return { project, path: safe.normalized, deleted: true };
    },

    async moveText(input) {
      const { project, fromPath, toPath } = input || {};
      const source = safePlanMarkdownPath(fromPath);
      const destination = safePlanMarkdownPath(toPath);
      if (source.normalized === destination.normalized) {
        throw new ProjectFilesValidationError(
          "The source and destination paths must differ",
        );
      }
      await ensureFolders(project, destination.parts.slice(0, -1));
      const sourceUrl = dav(project, source.normalized).url;
      let etag;
      if (Object.prototype.hasOwnProperty.call(input, "expectedEtag")) {
        etag = expectedEtag(input.expectedEtag);
      } else {
        etag = await currentEtag(sourceUrl);
        if (etag === null) {
          throw new ProjectFilesValidationError("File not found", 404);
        }
      }
      const destinationUrl = dav(project, destination.normalized).url;
      const response = await fetchDav(sourceUrl, {
        method: "MOVE",
        headers: {
          Destination: `https://${config.nextcloudHost}${destinationUrl.pathname}`,
          "If-Match": etag,
          Overwrite: "F",
        },
      });
      await response.body?.cancel();
      if (response.status === 404) {
        throw new ProjectFilesValidationError("File not found", 404);
      }
      if (response.status === 412) {
        throw conflict("The source changed or the destination already exists");
      }
      if (![200, 201, 204].includes(response.status)) {
        throw new Error("Nextcloud MOVE failed with HTTP " + response.status);
      }
      return {
        project,
        fromPath: source.normalized,
        toPath: destination.normalized,
        moved: true,
      };
    },

    async download({ project, path: relative }) {
      const safe = safeProjectFilePath(relative);
      if (!safe.normalized)
        throw new ProjectFilesValidationError("A file path is required");
      const response = await fetchDav(dav(project, safe.normalized).url, {
        method: "GET",
      });
      if (response.status === 404)
        throw new ProjectFilesValidationError("File not found", 404);
      if (response.status !== 200)
        throw new Error("Nextcloud GET failed with HTTP " + response.status);
      const declared = contentLength(response);
      if (declared !== null && declared > MAX_DOWNLOAD_BYTES) {
        await response.body?.cancel();
        throw new ProjectFilesValidationError(
          "The file is too large to download here",
          413,
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_DOWNLOAD_BYTES) {
        throw new ProjectFilesValidationError(
          "The file is too large to download here",
          413,
        );
      }
      return {
        bytes,
        filename: safe.parts.at(-1),
        contentType:
          response.headers.get("content-type") || "application/octet-stream",
      };
    },
  };
}
