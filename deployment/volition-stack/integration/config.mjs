import path from "node:path";
import net from "node:net";
import fs from "node:fs/promises";

function absolutePath(value, fallback) {
  const selected = value?.trim() || fallback;
  if (!path.isAbsolute(selected))
    throw new Error("Provisioning paths must be absolute");
  return path.normalize(selected);
}

function optionalAbsolutePath(value) {
  if (!value?.trim()) return "";
  return absolutePath(value);
}

function port(value) {
  const parsed = Number(value ?? 18800);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("PROVISIONING_PORT must be a valid TCP port");
  }
  return parsed;
}

function bindHost(value, allowWildcard = false) {
  const host = value?.trim() || "127.0.0.1";
  if (host === "0.0.0.0" && allowWildcard) return host;
  if (host === "::1") return host;
  if (net.isIPv4(host)) {
    const [first, second] = host.split(".").map(Number);
    if (
      first === 127 ||
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    ) {
      return host;
    }
  }
  throw new Error("PROVISIONING_HOST must be a loopback or RFC1918 address");
}

function publicUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Public service URLs must use http or https");
  }
  return url.toString();
}

function nextcloudInternalUrl(value) {
  const url = new URL(value || "http://127.0.0.1:8092");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "nextcloud"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "NEXTCLOUD_INTERNAL_URL must use loopback or the known internal nextcloud service",
    );
  }
  return url.toString();
}

function privateServiceBaseUrl(value, fallback, name) {
  const url = new URL(value || fallback);
  const host = url.hostname;
  const privateHost =
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "api" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol !== "http:" || !privateHost || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an unauthenticated private HTTP URL`);
  }
  return url.toString();
}

function hostname(value, fallback, name = "HOSTNAME") {
  const selected = value?.trim() || fallback;
  if (!/^[a-z0-9.-]+$/i.test(selected)) throw new Error(`${name} is invalid`);
  return selected;
}

function boundedText(value, fallback, name, maximum) {
  const selected = value?.trim() || fallback;
  if (!selected || selected.length > maximum) throw new Error(`${name} is invalid`);
  return selected;
}

function browserProfile(value) {
  const profile = value?.trim() || "openclaw";
  if (!/^[a-z0-9._-]{1,64}$/i.test(profile)) throw new Error("BROWSER_PROFILE is invalid");
  return profile;
}

function projectKey(value, fallback) {
  const key = value?.trim().toLowerCase() || fallback;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)) throw new Error("Project key is invalid");
  return key;
}

function opaqueRef(value, fallback, name) {
  const selected = value?.trim() || fallback;
  if (!/^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/.test(selected)) {
    throw new Error(`${name} is invalid`);
  }
  return selected;
}

function capabilityRef(value, fallback, name) {
  const selected = value?.trim() || fallback;
  if (!/^[a-z][a-z0-9._-]*\.v\d+$/.test(selected)) throw new Error(`${name} is invalid`);
  return selected;
}

function privateServiceUrl(value, fallback, expectedPath) {
  const url = new URL(value || fallback);
  const host = url.hostname;
  const privateHost =
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "worker" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (
    url.protocol !== "http:" ||
    !privateHost ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new Error("The private service URL is invalid");
  }
  return url.toString();
}

function loopbackWebSocketUrl(value) {
  const url = new URL(value || "ws://127.0.0.1:18789");
  if (
    url.protocol !== "ws:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("OPENCLAW_GATEWAY_URL must be an unauthenticated loopback WebSocket URL");
  }
  return url.toString();
}

function triageTransport(value) {
  const transport = value?.trim() || "cli";
  if (transport !== "cli" && transport !== "rpc") {
    throw new Error("OPENCLAW_TRIAGE_TRANSPORT must be cli or rpc");
  }
  return transport;
}

function triageControlPlane(value) {
  const selected = value?.trim() || "direct";
  if (selected !== "direct" && selected !== "mastra") {
    throw new Error("INBOX_TRIAGE_CONTROL_PLANE must be direct or mastra");
  }
  return selected;
}

function inboxAgentId(value) {
  const agentId = value?.trim() || "inbox-classifier";
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(agentId)) {
    throw new Error("OPENCLAW_INBOX_AGENT_ID must be a valid dedicated agent ID");
  }
  return agentId;
}

function jsonStringRecord(value, name) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  const entries = Object.entries(parsed);
  if (entries.some(([key, item]) => !key || typeof item !== "string" || !item)) {
    throw new Error(`${name} must contain non-empty string values`);
  }
  return Object.fromEntries(entries);
}

function jsonPositiveIntegerRecord(value, name) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  const entries = Object.entries(parsed);
  if (
    entries.some(
      ([key, item]) =>
        !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key) ||
        !Number.isSafeInteger(item) ||
        item < 1,
    )
  ) {
    throw new Error(`${name} must map safe project keys to positive integers`);
  }
  return Object.fromEntries(entries);
}

async function privateSecret(filePath, name) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${name} must be a private regular file`);
  }
  const value = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (Buffer.byteLength(value) < 32 || value.length > 2048) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

async function privateCredential(filePath, name) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${name} must be a private regular file`);
  }
  const value = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (!value || value.length > 2048) throw new Error(`${name} is invalid`);
  return value;
}

export function loadConfig(env = process.env) {
  const home = absolutePath(env.HOME, "/home/pw");
  const openClawRoot = absolutePath(
    env.OPENCLAW_ROOT,
    path.join(home, ".openclaw"),
  );
  const projectsRoot = absolutePath(
    env.PROJECTS_ROOT,
    "/home/pw/services/volition-workspaces/projects",
  );
  return {
    host: bindHost(env.PROVISIONING_HOST, env.PROVISIONING_ALLOW_WILDCARD_BIND === "true"),
    port: port(env.PROVISIONING_PORT),
    token:
      env.PROVISIONING_TOKEN?.trim() ||
      env.OPENCLAW_PROVISIONING_TOKEN?.trim() ||
      "",
    provisioningTokenFile: optionalAbsolutePath(env.PROVISIONING_TOKEN_FILE),
    projectsRoot,
    verveProjectPath: absolutePath(
      env.VERVE_PROJECT_PATH,
      "/home/pw/Projekte/Shopify/v1-cart-suite",
    ),
    openClawBin: absolutePath(
      env.OPENCLAW_BIN,
      path.join(home, ".npm-global/bin/openclaw"),
    ),
    openClawGatewayUrl: loopbackWebSocketUrl(env.OPENCLAW_GATEWAY_URL),
    openClawGatewayPasswordFile: absolutePath(
      env.OPENCLAW_GATEWAY_PASSWORD_FILE,
      "/run/credentials/volition-provisioning.service/openclaw_gateway_password",
    ),
    inboxTriageTransport: triageTransport(env.OPENCLAW_TRIAGE_TRANSPORT),
    inboxTriageControlPlane: triageControlPlane(env.INBOX_TRIAGE_CONTROL_PLANE),
    inboxAgentId: inboxAgentId(env.OPENCLAW_INBOX_AGENT_ID),
    connectionsIntegrationTokenFile: absolutePath(
      env.CONNECTIONS_INTEGRATION_TOKEN_FILE,
      path.join(openClawRoot, "volition/connections-integration-token"),
    ),
    connectionsEnabled: env.CONNECTIONS_ENABLED === "true",
    mailEnabled: env.MAIL_ENABLED === "true",
    artifactSyncEnabled: env.ARTIFACT_SYNC_ENABLED === "true",
    openClawRoot,
    coordinatorPolicyPath: absolutePath(
      env.OPENCLAW_COORDINATOR_POLICY_FILE,
      path.join(openClawRoot, "volition/coordinator-policy.json"),
    ),
    agentWorkspaceRoot: absolutePath(
      env.OPENCLAW_WORKSPACE_ROOT,
      path.join(openClawRoot, "workspace"),
    ),
    agentStateRoot: absolutePath(
      env.OPENCLAW_AGENT_ROOT,
      path.join(openClawRoot, "agents"),
    ),
    registryRoot: absolutePath(
      env.PROVISIONING_REGISTRY_ROOT,
      path.join(openClawRoot, "volition/projects"),
    ),
    ledgerPath: absolutePath(
      env.PROVISIONING_LEDGER_PATH,
      path.join(openClawRoot, "volition/provisioning-ledger.json"),
    ),
    planUrl: publicUrl(env.PLAN_PUBLIC_URL),
    planPublicUrl: publicUrl(env.PLAN_PUBLIC_URL),
    planInternalUrl: privateServiceBaseUrl(
      env.PLAN_INTERNAL_URL,
      "http://127.0.0.1:3000",
      "PLAN_INTERNAL_URL",
    ),
    planApiKey: env.ITSAPLAN_MCP_BEARER?.trim() || "",
    planDefaultDepartmentName: boundedText(
      env.PLAN_DEFAULT_DEPARTMENT_NAME,
      "Quality & Operations",
      "PLAN_DEFAULT_DEPARTMENT_NAME",
      80,
    ),
    planSecretAllowHost: hostname(
      env.PLAN_SECRET_ALLOW_HOST,
      "plan-api.volition.one",
      "PLAN_SECRET_ALLOW_HOST",
    ),
    codeUrl: publicUrl(env.CODE_PUBLIC_URL),
    codeSettingsPath: absolutePath(
      env.CODE_SETTINGS_PATH,
      "/home/pw/services/volition-stack/.state/code-user-settings/settings.json",
    ),
    openClawUrl: publicUrl(env.OPENCLAW_PUBLIC_URL),
    browserStartUrl: publicUrl(env.BROWSER_START_URL || "https://example.com"),
    browserProfile: browserProfile(env.BROWSER_PROFILE),
    filesUrl: publicUrl(env.FILES_PUBLIC_URL),
    nextcloudInternalUrl: nextcloudInternalUrl(env.NEXTCLOUD_INTERNAL_URL),
    artifactSyncStatePath: absolutePath(
      env.ARTIFACT_SYNC_STATE_PATH,
      path.join(openClawRoot, "volition/artifact-sync.json"),
    ),
    nextcloudHost: hostname(env.NEXTCLOUD_HOST, "cloud.volition.one", "NEXTCLOUD_HOST"),
    nextcloudUser: env.NEXTCLOUD_USER?.trim() || "owner@example.com",
    nextcloudPasswordFile: absolutePath(
      env.NEXTCLOUD_APP_PASSWORD_FILE,
      "/home/pw/services/volition-stack/.secrets/nextcloud_patrick_app_password",
    ),
    inboxAccounts: Object.keys(jsonStringRecord(env.INBOX_BASELINES, "INBOX_BASELINES")),
    inboxBaselines: jsonStringRecord(env.INBOX_BASELINES, "INBOX_BASELINES"),
    inboxQueuePath: absolutePath(
      env.INBOX_PUSH_QUEUE_PATH,
      path.join(openClawRoot, "volition/inbox-push.json"),
    ),
    inboxTriagePath: absolutePath(
      env.INBOX_TRIAGE_PATH,
      path.join(openClawRoot, "volition/inbox-triage.json"),
    ),
    inboxTriagePromptRoot: absolutePath(
      env.INBOX_TRIAGE_PROMPT_ROOT,
      path.join(openClawRoot, "volition/triage-prompts"),
    ),
    inboxIntegrationTokenFile: absolutePath(
      env.INBOX_INTEGRATION_TOKEN_FILE,
      path.join(openClawRoot, "volition/inbox-integration-token"),
    ),
    inboxPushTokenFile: absolutePath(
      env.INBOX_PUSH_TOKEN_FILE,
      "/home/pw/services/volition-stack/.secrets/inbox_push_token",
    ),
    mastraInboxUrl: privateServiceUrl(
      env.MASTRA_INBOX_URL,
      "http://172.30.95.2:4111/internal/inbox/triage",
      "/internal/inbox/triage",
    ),
    mastraInboxTokenFile: absolutePath(
      env.MASTRA_INBOX_TOKEN_FILE,
      "/run/credentials/volition-provisioning.service/mastra_inbox_adapter_token",
    ),
    mastraInboxOrganizationRef: opaqueRef(
      env.MASTRA_INBOX_ORGANIZATION_REF,
      "organization:volition",
      "MASTRA_INBOX_ORGANIZATION_REF",
    ),
    mastraInboxProjectRef: opaqueRef(
      env.MASTRA_INBOX_PROJECT_REF,
      "project:PRIV",
      "MASTRA_INBOX_PROJECT_REF",
    ),
    mastraInboxCapabilityRef: capabilityRef(
      env.MASTRA_INBOX_CAPABILITY_REF,
      "inbox-triage.v1",
      "MASTRA_INBOX_CAPABILITY_REF",
    ),
    mastraInboxClassifierSocketPath: absolutePath(
      env.MASTRA_INBOX_CLASSIFIER_SOCKET,
      path.join(openClawRoot, "volition/ipc/mastra-inbox-classifier.sock"),
    ),
    mastraControlEnabled: env.MASTRA_CONTROL_ENABLED === "true",
    mastraControlUrl: privateServiceBaseUrl(
      env.MASTRA_CONTROL_URL,
      "http://172.30.95.2:4111/mastra/api/",
      "MASTRA_CONTROL_URL",
    ),
    mastraControlTokenFile: absolutePath(
      env.MASTRA_CONTROL_TOKEN_FILE,
      "/run/credentials/volition-provisioning.service/plan_mastra_control_token",
    ),
    mastraControlOwnerEmail: env.MASTRA_CONTROL_OWNER_EMAIL?.trim() || "owner@example.com",
    inboxWorkerWakeUrl: privateServiceUrl(
      env.INBOX_WORKER_WAKE_URL,
      "http://172.30.254.2:18801/internal/inbox/wake",
      "/internal/inbox/wake",
    ),
    gogBin: absolutePath(env.GOG_BIN, path.join(home, ".local/bin/gog")),
    gogHome: absolutePath(
      env.GOG_HOME,
      path.join(home, ".local/share/openclaw-gog"),
    ),
    gogKeyringPasswordFile: absolutePath(
      env.GOG_KEYRING_PASSWORD_FILE,
      path.join(home, ".local/share/openclaw-gog/keyring.pass"),
    ),
  };
}

export async function loadServerSecrets(config) {
  const token =
    config.token ||
    (config.provisioningTokenFile
      ? await privateSecret(config.provisioningTokenFile, "PROVISIONING_TOKEN_FILE")
      : "");
  const artifactSecrets = config.artifactSyncEnabled || config.connectionsEnabled
    ? await loadArtifactSyncSecrets(config)
    : {};
  const mastraControlToken = config.mastraControlEnabled
    ? await privateSecret(config.mastraControlTokenFile, "MASTRA_CONTROL_TOKEN_FILE")
    : "";
  if (config.inboxAccounts.length === 0) return { ...config, token, mastraControlToken, ...artifactSecrets };
  const connectionsIntegrationToken = config.connectionsEnabled || config.mailEnabled
    ? await privateSecret(config.connectionsIntegrationTokenFile, "CONNECTIONS_INTEGRATION_TOKEN_FILE") : "";
  const [inboxIntegrationToken, inboxPushToken, gogKeyringPassword, openClawGatewayPassword, mastraInboxToken] =
    await Promise.all([
      privateSecret(config.inboxIntegrationTokenFile, "INBOX_INTEGRATION_TOKEN_FILE"),
      privateSecret(config.inboxPushTokenFile, "INBOX_PUSH_TOKEN_FILE"),
      privateSecret(config.gogKeyringPasswordFile, "GOG_KEYRING_PASSWORD_FILE"),
      config.inboxTriageTransport === "rpc" || config.connectionsEnabled
        ? privateSecret(config.openClawGatewayPasswordFile, "OPENCLAW_GATEWAY_PASSWORD_FILE")
        : Promise.resolve(""),
      config.inboxTriageControlPlane === "mastra"
        ? privateSecret(config.mastraInboxTokenFile, "MASTRA_INBOX_TOKEN_FILE")
        : Promise.resolve(""),
    ]);
  return {
    ...config,
    ...artifactSecrets,
    token,
    mastraControlToken,
    inboxIntegrationToken,
    connectionsIntegrationToken,
    inboxPushToken,
    gogKeyringPassword,
    openClawGatewayPassword,
    mastraInboxToken,
  };
}

export async function loadArtifactSyncSecrets(config) {
  if (!config.artifactSyncEnabled && !config.connectionsEnabled) return {};
  const nextcloudPassword = await privateCredential(
    config.nextcloudPasswordFile,
    "NEXTCLOUD_APP_PASSWORD_FILE",
  );
  return { nextcloudPassword };
}

export function assertServerConfig(config) {
  if (Buffer.byteLength(config.token) < 32) {
    throw new Error("PROVISIONING_TOKEN must contain at least 32 bytes");
  }
  for (const [name, value] of [
    ["INBOX_INTEGRATION_TOKEN", config.inboxIntegrationToken],
    ["INBOX_PUSH_TOKEN", config.inboxPushToken],
    ...(config.connectionsEnabled || config.mailEnabled ? [["CONNECTIONS_INTEGRATION_TOKEN", config.connectionsIntegrationToken]] : []),
    ...(config.inboxTriageTransport === "rpc" || config.connectionsEnabled
      ? [["OPENCLAW_GATEWAY_PASSWORD", config.openClawGatewayPassword]]
      : []),
    ...(config.inboxTriageControlPlane === "mastra"
      ? [["MASTRA_INBOX_TOKEN", config.mastraInboxToken]]
      : []),
    ...(config.mastraControlEnabled
      ? [["MASTRA_CONTROL_TOKEN", config.mastraControlToken]]
      : []),
  ]) {
    if (config.inboxAccounts?.length && Buffer.byteLength(value || "") < 32) {
      throw new Error(`${name} must contain at least 32 bytes`);
    }
  }
  if (config.artifactSyncEnabled) {
    for (const [name, value] of [
      ["ITSAPLAN_MCP_BEARER", config.planApiKey],
      ["NEXTCLOUD_APP_PASSWORD", config.nextcloudPassword],
    ]) {
      if (!value) throw new Error(`${name} is required when artifact sync is enabled`);
    }
    if (!config.planPublicUrl || !config.filesUrl) {
      throw new Error("Artifact sync public URLs are required when artifact sync is enabled");
    }
  }
  if (config.connectionsEnabled) {
    for (const [name, value] of [
      ["NEXTCLOUD_APP_PASSWORD", config.nextcloudPassword],
    ]) {
      if (!value) throw new Error(`${name} is required when connections are enabled`);
    }
  }
}
