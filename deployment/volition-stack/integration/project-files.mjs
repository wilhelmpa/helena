import path from "node:path";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MAX_LIST_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 500;

export class ProjectFilesValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProjectFilesValidationError";
    this.status = status;
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
        /[\u0000-\u001f\u007f\\]/.test(part),
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
    items.push({
      name: relative,
      path: [currentPath, relative].filter(Boolean).join("/"),
      kind: directory ? "folder" : "file",
      sizeBytes: directory || !Number.isFinite(size) ? null : size,
      contentType: directory
        ? null
        : tag(block, "getcontenttype") || "application/octet-stream",
      updatedAt: parseModified(tag(block, "getlastmodified")),
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

  return {
    async list({ project, path: relative = "" }) {
      const target = dav(project, relative);
      const response = await fetchDav(target.url, {
        method: "PROPFIND",
        headers: {
          Depth: "1",
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: '<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/></d:prop></d:propfind>',
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
      };
    },

    async createText({ project, path: relative, content }) {
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
      const response = await fetchDav(dav(project, safe.normalized).url, {
        method: "PUT",
        headers: {
          "Content-Type":
            path.extname(safe.normalized).toLowerCase() === ".txt"
              ? "text/plain; charset=utf-8"
              : "text/markdown; charset=utf-8",
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
