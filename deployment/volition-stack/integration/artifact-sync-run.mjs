import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import { createArtifactSyncService } from "./artifact-sync.mjs";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";

const PROJECT_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function url(value, name, { privateOnly = false } = {}) {
  const parsed = new URL(value);
  const privateHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || /^10\./.test(parsed.hostname) || /^192\.168\./.test(parsed.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname);
  if ((privateOnly && (parsed.protocol !== "http:" || !privateHost)) || (!privateOnly && !["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
    throw new Error(`${name} is invalid`);
  }
  return parsed.toString();
}

async function credential(filePath, name) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${name} must be a private regular file`);
  const value = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (!value || value.length > 2048) throw new Error(`${name} is invalid`);
  return value;
}

export async function loadArtifactConfig(env = process.env) {
  return {
    planInternalUrl: url(env.PLAN_INTERNAL_URL || "http://127.0.0.1:3000", "PLAN_INTERNAL_URL", { privateOnly: true }),
    planPublicUrl: url(env.PLAN_PUBLIC_URL, "PLAN_PUBLIC_URL"),
    planApiKey: env.ITSAPLAN_MCP_BEARER?.trim() || "",
    nextcloudInternalUrl: url(env.NEXTCLOUD_INTERNAL_URL || "http://127.0.0.1:8092", "NEXTCLOUD_INTERNAL_URL", { privateOnly: true }),
    nextcloudHost: env.NEXTCLOUD_HOST,
    nextcloudUser: env.NEXTCLOUD_USER,
    nextcloudPassword: await credential(env.NEXTCLOUD_APP_PASSWORD_FILE, "NEXTCLOUD_APP_PASSWORD_FILE"),
    filesUrl: url(env.FILES_PUBLIC_URL, "FILES_PUBLIC_URL"),
    artifactSyncStatePath: env.ARTIFACT_SYNC_STATE_PATH || "/home/pw/services/volition-workspaces/.state/integration/artifact-sync.json",
  };
}

export async function discoverProjects(config, request) {
  const response = await request(new URL("/projects", config.planInternalUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", "x-api-key": config.planApiKey },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`Plan project discovery failed with HTTP ${response.status}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Plan returned invalid project metadata");
  const keys = rows.map((row) => String(row?.key || "").toLowerCase());
  if (keys.some((key) => !PROJECT_KEY.test(key))) throw new Error("Plan returned an invalid project key");
  return [...new Set(keys)];
}

export async function pruneRemovedProjectState(config, activeProjectKeys, options = {}) {
  const active = new Set(activeProjectKeys);
  if ([...active].some((key) => !PROJECT_KEY.test(key))) throw new Error("Active project key is invalid");
  const readState = options.readJson ?? readJson;
  const writeState = options.writeJsonAtomic ?? writeJsonAtomic;
  const state = await readState(config.artifactSyncStatePath, { schemaVersion: 1, projects: {} });
  const projects = state?.projects && !Array.isArray(state.projects) ? state.projects : {};
  const removed = Object.keys(projects).filter((key) => !active.has(key)).sort();
  if (!removed.length) return removed;
  const retained = Object.fromEntries(Object.entries(projects).filter(([key]) => active.has(key)));
  await writeState(config.artifactSyncStatePath, { ...state, schemaVersion: 1, projects: retained });
  return removed;
}

export async function runArtifactSync(env = process.env, options = {}) {
  if (env.ARTIFACT_SYNC_ENABLED !== "true") throw new Error("Artifact sync is disabled");
  const config = await loadArtifactConfig(env);
  if (!config.planApiKey || !config.planPublicUrl || !config.filesUrl) {
    throw new Error("Artifact sync configuration is incomplete");
  }
  const service = createArtifactSyncService(config, options);
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");
  const results = [];
  const request = options.fetch ?? fetch;
  const projectKeys = await discoverProjects(config, request);
  for (const projectKey of projectKeys) {
    results.push(await service.sync({ projectKey, dryRun }));
  }
  if (!dryRun) await pruneRemovedProjectState(config, projectKeys, options);
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const results = await runArtifactSync();
  console.log(JSON.stringify({ ok: true, results }));
}
