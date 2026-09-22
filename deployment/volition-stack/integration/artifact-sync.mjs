import crypto from "node:crypto";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";

const PROJECT_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_PLAN_DOCUMENTS = 500;

export class ArtifactSyncValidationError extends Error {}

function cleanName(value, fallback) {
  const name = String(value || fallback)
    .normalize("NFKC")
    .replace(/[\0-\x1f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name || fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodePath(parts) {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function privateLink(config, fileId) {
  if (!fileId || !config.filesUrl) return null;
  const root = new URL(config.filesUrl).origin;
  return `${root}/f/${encodeURIComponent(fileId)}`;
}

export function createArtifactSyncService(config, options = {}) {
  const request = options.fetch ?? fetch;
  const readState = options.readJson ?? readJson;
  const writeState = options.writeJsonAtomic ?? writeJsonAtomic;
  const ensuredFolders = new Set();
  let running = false;

  const nextcloudAuthorization = `Basic ${Buffer.from(`${config.nextcloudUser}:${config.nextcloudPassword}`).toString("base64")}`;

  async function checkedFetch(url, init, expected) {
    const response = await request(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (!expected.includes(response.status)) {
      await response.body?.cancel();
      throw new Error(`Source request failed with HTTP ${response.status}`);
    }
    return response;
  }

  async function jsonSource(url, headers) {
    const response = await checkedFetch(url, { headers: { Accept: "application/json", ...headers } }, [200]);
    const text = await response.text();
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Source metadata exceeds the limit");
    return JSON.parse(text);
  }

  async function bytesSource(url, headers, optional = false) {
    const response = await request(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
      headers,
    });
    if (optional && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Source download failed with HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_SOURCE_BYTES) {
      await response.body?.cancel();
      throw new Error("Source artifact exceeds the size limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Source artifact exceeds the size limit");
    return bytes;
  }

  function davUrl(parts) {
    const base = new URL(config.nextcloudInternalUrl);
    const root = ["remote.php", "dav", "files", config.nextcloudUser, ...parts];
    return new URL(`/${encodePath(root)}`, base);
  }

  async function dav(url, method, body, extraHeaders = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(url, {
        method,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
        headers: {
          Authorization: nextcloudAuthorization,
          Host: config.nextcloudHost,
          ...extraHeaders,
        },
      });
      if (![429, 503].includes(response.status) || attempt === 2) return response;
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  async function ensureFolders(parts, dryRun) {
    if (dryRun) return;
    const key = parts.join("/");
    if (ensuredFolders.has(key)) return;
    for (let index = 1; index <= parts.length; index += 1) {
      const response = await dav(davUrl(parts.slice(0, index)), "MKCOL");
      await response.body?.cancel();
      if (![201, 405].includes(response.status)) throw new Error(`Nextcloud folder creation failed with HTTP ${response.status}`);
    }
    ensuredFolders.add(key);
  }

  async function verifyFile(parts, expectedHash) {
    const response = await dav(davUrl(parts), "GET");
    if (response.status !== 200) {
      await response.body?.cancel();
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== expectedHash) throw new Error("Nextcloud conflict: existing file content differs");
    return fileFacts(parts);
  }

  async function fileFacts(parts) {
    const body = Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/><d:getetag/></d:prop></d:propfind>');
    const response = await dav(davUrl(parts), "PROPFIND", body, { Depth: "0", "Content-Type": "application/xml; charset=utf-8" });
    if (response.status !== 207) {
      await response.body?.cancel();
      throw new Error(`Nextcloud file verification failed with HTTP ${response.status}`);
    }
    const xml = await response.text();
    const fileId = /<(?:oc:)?fileid[^>]*>(\d+)<\//i.exec(xml)?.[1] ?? null;
    const etag = /<(?:d:)?getetag[^>]*>\s*&quot;?([^<&"]+)/i.exec(xml)?.[1] ?? null;
    return { fileId, etag, link: privateLink(config, fileId) };
  }

  async function putImmutable(parts, bytes, hash, dryRun) {
    if (dryRun) return { fileId: null, etag: null, link: null, action: "planned" };
    const response = await dav(davUrl(parts), "PUT", bytes, {
      "If-None-Match": "*",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
    });
    await response.body?.cancel();
    if (response.status === 412) return { ...(await verifyFile(parts, hash)), action: "existing" };
    if (![201, 204].includes(response.status)) throw new Error(`Nextcloud upload failed with HTTP ${response.status}`);
    return { ...(await fileFacts(parts)), action: "created" };
  }

  async function planDocuments(projectKey) {
    const headers = { "x-api-key": config.planApiKey };
    const base = new URL(config.planInternalUrl);
    const summaries = [];
    for (const archived of [false, true]) {
      const url = new URL(`/projects/${encodeURIComponent(projectKey.toUpperCase())}/documents`, base);
      if (archived) url.searchParams.set("archived", "true");
      const rows = await jsonSource(url, headers);
      if (!Array.isArray(rows)) throw new Error("Plan returned invalid document metadata");
      summaries.push(...rows);
    }
    if (summaries.length > MAX_PLAN_DOCUMENTS) throw new Error("Plan document limit exceeded");
    const result = [];
    for (const summary of summaries) {
      if (!Number.isSafeInteger(summary.id) || !Number.isSafeInteger(summary.version)) continue;
      const exportUrl = new URL(`/projects/${encodeURIComponent(projectKey.toUpperCase())}/documents/${summary.id}/export`, base);
      const issuesUrl = new URL(`/projects/${encodeURIComponent(projectKey.toUpperCase())}/documents/${summary.id}/issues`, base);
      const issues = await jsonSource(issuesUrl, headers);
      const name = cleanName(summary.title, `document-${summary.id}`).replace(/\.md$/i, "");
      const documentUrl = new URL(`/project/${encodeURIComponent(projectKey.toUpperCase())}/docs/${summary.id}`, config.planPublicUrl).toString();
      const issueLinks = Array.isArray(issues)
        ? issues.slice(0, 100).map((issue) => ({
            identifier: issue.identifier,
            title: String(issue.title || "").slice(0, 500),
            url: new URL(`/project/${encodeURIComponent(projectKey.toUpperCase())}/issue/${issue.sequenceNumber}`, config.planPublicUrl).toString(),
          }))
        : [];
      result.push({
        key: `plan:${summary.id}`,
        source: "plan",
        loadBytes: async () => {
          const exported = await jsonSource(exportUrl, headers);
          if (exported.version !== summary.version) throw new Error("Plan document changed during sync");
          return Buffer.from(String(exported.content || ""), "utf8");
        },
        fileName: (hash) => `${name}--doc-${summary.id}-v${summary.version}-${hash.slice(0, 12)}.md`,
        folder: summary.archivedAt ? "Archiv" : "Dokumente",
        sourceFingerprint: sha256(JSON.stringify({ version: summary.version, title: summary.title ?? null, archivedAt: summary.archivedAt ?? null, issueLinks })),
        metadata: {
          documentId: summary.id,
          version: summary.version,
          title: String(summary.title || "").slice(0, 500),
          archivedAt: summary.archivedAt ?? null,
          documentUrl,
          issueLinks,
        },
      });
    }
    return result;
  }

  async function status() {
    const state = await readState(config.artifactSyncStatePath, { projects: {} });
    return {
      running,
      projects: Object.fromEntries(Object.entries(state.projects ?? {}).map(([key, value]) => [key, {
        lastSuccessAt: value.lastSuccessAt ?? null,
        lastDryRunAt: value.lastDryRunAt ?? null,
        lastError: value.lastError ?? null,
        artifactCount: Object.keys(value.artifacts ?? {}).length,
      }])),
    };
  }

  async function sync(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["projectKey", "dryRun"].includes(key))) {
      throw new ArtifactSyncValidationError("Artifact sync input is invalid");
    }
    const projectKey = String(input.projectKey || "").toLowerCase();
    if (!PROJECT_KEY.test(projectKey) || (input.dryRun !== undefined && typeof input.dryRun !== "boolean")) {
      throw new ArtifactSyncValidationError("Artifact sync input is invalid");
    }
    if (running) throw new ArtifactSyncValidationError("Artifact sync is already running");
    const dryRun = input.dryRun === true;
    running = true;
    const startedAt = new Date().toISOString();
    try {
      const artifacts = await planDocuments(projectKey);
      const state = await readState(config.artifactSyncStatePath, { schemaVersion: 1, projects: {} });
      const prior = state.projects?.[projectKey] ?? { artifacts: {} };
      const nextArtifacts = { ...(prior.artifacts ?? {}) };
      const actions = [];
      for (const artifact of artifacts) {
        const root = ["Projects", projectKey, artifact.folder, "Plan"];
        const previous = prior.artifacts?.[artifact.key];
        if (previous?.sourceFingerprint === artifact.sourceFingerprint && previous.hash && previous.path) {
          if (dryRun || (previous.fileId && previous.link)) {
            nextArtifacts[artifact.key] = previous;
            actions.push({ key: artifact.key, action: "unchanged", path: previous.path, fileId: previous.fileId ?? null, link: previous.link ?? null, hash: previous.hash });
            continue;
          }
          const facts = await fileFacts(previous.path.split("/").filter(Boolean));
          const record = { ...previous, fileId: facts.fileId, link: facts.link, etag: facts.etag };
          nextArtifacts[artifact.key] = record;
          actions.push({ key: artifact.key, action: "verified", path: record.path, fileId: record.fileId, link: record.link, hash: record.hash });
          continue;
        }
        const bytes = await artifact.loadBytes();
        if (!bytes) continue;
        const hash = artifact.knownHash ?? sha256(bytes);
        const fileName = artifact.fileName(hash);
        let uploaded;
        let artifactPath;
        if (previous?.hash === hash && previous.path) {
          uploaded = { ...previous, action: "metadata-updated" };
          artifactPath = previous.path;
        } else {
          await ensureFolders(root, dryRun);
          uploaded = await putImmutable([...root, fileName], bytes, hash, dryRun);
          artifactPath = `/${[...root, fileName].join("/")}`;
        }
        const record = {
          source: artifact.source,
          sourceFingerprint: artifact.sourceFingerprint,
          hash,
          size: bytes.length,
          path: artifactPath,
          fileId: uploaded.fileId ?? previous?.fileId ?? null,
          link: uploaded.link ?? previous?.link ?? null,
          metadata: artifact.metadata,
          syncedAt: startedAt,
        };
        nextArtifacts[artifact.key] = record;
        actions.push({ key: artifact.key, action: uploaded.action, path: record.path, fileId: record.fileId, link: record.link, hash: record.hash });
      }
      const artifactSnapshotHash = sha256(JSON.stringify(nextArtifacts));
      let lastManifest = prior.lastManifest ?? null;
      if (artifactSnapshotHash !== prior.artifactSnapshotHash || !lastManifest) {
        const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: 1, projectKey, generatedAt: startedAt, artifacts: nextArtifacts }, null, 2)}\n`);
        const manifestHash = sha256(manifest);
        const manifestRoot = ["Projects", projectKey, "Dokumente", ".volition-sync"];
        await ensureFolders(manifestRoot, dryRun);
        const manifestName = `manifest-${startedAt.replace(/[:.]/g, "-")}-${manifestHash.slice(0, 12)}.json`;
        const manifestResult = await putImmutable([...manifestRoot, manifestName], manifest, manifestHash, dryRun);
        lastManifest = { path: `/${[...manifestRoot, manifestName].join("/")}`, fileId: manifestResult.fileId, link: manifestResult.link, hash: manifestHash };
      }
      const projectState = {
        artifacts: nextArtifacts,
        artifactSnapshotHash,
        lastSuccessAt: dryRun ? prior.lastSuccessAt ?? null : startedAt,
        lastDryRunAt: dryRun ? startedAt : prior.lastDryRunAt ?? null,
        lastError: null,
        lastManifest,
      };
      if (!dryRun) await writeState(config.artifactSyncStatePath, { ...state, schemaVersion: 1, projects: { ...(state.projects ?? {}), [projectKey]: projectState } });
      return { projectKey, dryRun, startedAt, artifactCount: artifacts.length, actions, manifest: projectState.lastManifest };
    } catch (error) {
      if (!dryRun) {
        const state = await readState(config.artifactSyncStatePath, { schemaVersion: 1, projects: {} });
        const prior = state.projects?.[projectKey] ?? { artifacts: {} };
        await writeState(config.artifactSyncStatePath, {
          ...state,
          schemaVersion: 1,
          projects: { ...(state.projects ?? {}), [projectKey]: { ...prior, lastError: String(error?.message || "Artifact sync failed").slice(0, 500), lastAttemptAt: startedAt } },
        });
      }
      throw error;
    } finally {
      running = false;
    }
  }

  return { sync, status };
}
