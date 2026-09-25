import path from "node:path";
import net from "node:net";
import fs from "node:fs/promises";

// A secret must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there.
function secretModeMask(file) {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

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

// A public service address: an absolute http(s) URL, or a path below Helena's public
// origin ("/code/"), which each provisioning request resolves against the origin Helena
// names in it (withPublicOrigin below). A path keeps the unit free of a host name that a
// move to another origin would leave stale (docs/helena-decisions/agent-context.md §1).
function publicUrlOrPath(value, name) {
  if (!value) return "";
  if (value.startsWith("/")) {
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(value) || value.includes("//") || value.includes("..")) {
      throw new Error(`${name} must be an http(s) URL or a plain path`);
    }
    return value;
  }
  return publicUrl(value);
}

// Helena's public origin as a provisioning request names it: the first entry of its APP_URL
// (apps/worker), always "https://host/" or "http://host/" with nothing else. Empty when the
// request names none (an older Helena).
export function publicOrigin(value) {
  if (typeof value !== "string" || !value) return "";
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("The public origin must be a bare http(s) origin");
  }
  return url.toString();
}

// The public addresses for one provisioning request. Helena's origin from the request wins
// over PLAN_PUBLIC_URL, which only an older Helena that sends none still needs; the service
// addresses given as paths are resolved against it, and ones given as URLs are kept.
export function withPublicOrigin(config, origin) {
  const planUrl = publicOrigin(origin) || config.planUrl || "";
  const resolve = (value) => {
    if (!value || !value.startsWith("/")) return value || "";
    return planUrl ? new URL(value, planUrl).toString() : "";
  };
  return {
    ...config,
    planUrl,
    codeUrl: resolve(config.codeUrl),
    terminalUrl: resolve(config.terminalUrl),
    projectBrowserPublicUrl: resolve(config.projectBrowserPublicUrl),
  };
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

function projectBrowserPublicUrl(value) {
  if (value?.startsWith("/")) {
    const path = publicUrlOrPath(value, "PROJECT_BROWSER_PUBLIC_URL");
    if (path === "/") throw new Error("PROJECT_BROWSER_PUBLIC_URL needs a base path");
    return path.endsWith("/") ? path : `${path}/`;
  }
  const url = new URL(value || "https://plan.volition.one/browser/");
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname.endsWith(".local") ||
      !url.hostname.includes("."));
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-z0-9/_-]+\/?$/i.test(url.pathname) ||
    url.pathname === "/"
  ) {
    throw new Error(
      "PROJECT_BROWSER_PUBLIC_URL must be a credential-free HTTPS URL or loopback HTTP URL with a base path",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function integerBase(value, fallback, name) {
  const selected = Number(value ?? fallback);
  if (!Number.isInteger(selected) || selected < 1 || selected > 65407) {
    throw new Error(`${name} is invalid`);
  }
  return selected;
}
function mailAddresses(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function privateSecret(filePath, name) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & secretModeMask(filePath)) !== 0) {
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
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & secretModeMask(filePath)) !== 0) {
    throw new Error(`${name} must be a private regular file`);
  }
  const value = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (!value || value.length > 2048) throw new Error(`${name} is invalid`);
  return value;
}

export function loadConfig(env = process.env) {
  const provisioningStateRoot = absolutePath(
    env.PROVISIONING_STATE_ROOT,
    "/var/lib/volition/provisioning",
  );
  const integrationStateRoot = absolutePath(
    env.INTEGRATION_STATE_ROOT,
    path.join(provisioningStateRoot, "integration"),
  );
  const projectsRoot = absolutePath(
    env.PROJECTS_ROOT,
    "/srv/volition/workspaces/projects",
  );
  return {
    host: bindHost(env.PROVISIONING_HOST, env.PROVISIONING_ALLOW_WILDCARD_BIND === "true"),
    port: port(env.PROVISIONING_PORT),
    token:
      env.PROVISIONING_TOKEN?.trim() || "",
    provisioningTokenFile: optionalAbsolutePath(env.PROVISIONING_TOKEN_FILE),
    projectsRoot,
    vaultRoot: absolutePath(env.VOLITION_VAULT_ROOT, "/srv/volition/vault"),
    projectTrashRoot: absolutePath(
      env.PROJECT_TRASH_ROOT,
      "/srv/volition/trash/projects",
    ),
    projectTrashRetentionDays: integerBase(
      env.PROJECT_TRASH_RETENTION_DAYS,
      30,
      "PROJECT_TRASH_RETENTION_DAYS",
    ),
    workspaceRuntimeRoot: absolutePath(env.WORKSPACE_RUNTIME_ROOT, "/projects"),
    verveProjectPath: absolutePath(
      env.VERVE_PROJECT_PATH,
      path.join(projectsRoot, "verve"),
    ),
    hermesBin: absolutePath(
      env.HERMES_BIN,
      "/var/lib/volition/hermes/venv/bin/hermes",
    ),
    hermesHome: absolutePath(
      env.HERMES_HOME,
      "/var/lib/volition/hermes",
    ),
    hermesAgentsRoot: absolutePath(
      env.HERMES_AGENTS_ROOT,
      "/var/lib/volition/hermes/agents",
    ),
    hermesRunnerDescriptorRoot: absolutePath(
      env.HERMES_RUNNER_DESCRIPTOR_ROOT,
      "/var/lib/volition/hermes/run/agents",
    ),
    hermesRunnerService: env.HERMES_RUNNER_SERVICE?.trim() || "volition-hermes-runner.service",
    connectionsIntegrationTokenFile: absolutePath(
      env.CONNECTIONS_INTEGRATION_TOKEN_FILE,
      path.join(integrationStateRoot, "connections-integration-token"),
    ),
    connectionsEnabled: env.CONNECTIONS_ENABLED === "true",
    registryRoot: absolutePath(
      env.PROVISIONING_REGISTRY_ROOT,
      path.join(provisioningStateRoot, "projects"),
    ),
    ledgerPath: absolutePath(
      env.PROVISIONING_LEDGER_PATH,
      path.join(provisioningStateRoot, "provisioning-ledger.json"),
    ),
    // Only for an older Helena that names no public origin in its requests.
    planUrl: publicUrl(env.PLAN_PUBLIC_URL),
    planInternalUrl: privateServiceBaseUrl(
      env.PLAN_INTERNAL_URL,
      "http://127.0.0.1:3000",
      "PLAN_INTERNAL_URL",
    ),
    planApiKey: env.ITSAPLAN_MCP_BEARER?.trim() || "",
    planApiKeyFile: optionalAbsolutePath(env.ITSAPLAN_MCP_BEARER_FILE),
    planControlTokenFile: optionalAbsolutePath(env.PLAN_CONTROL_TOKEN_FILE),
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
    codeUrl: publicUrlOrPath(env.CODE_PUBLIC_URL, "CODE_PUBLIC_URL"),
    terminalUrl: publicUrlOrPath(env.TERMINAL_PUBLIC_URL, "TERMINAL_PUBLIC_URL"),
    projectBrowserRoot: absolutePath(
      env.PROJECT_BROWSER_ROOT,
      "/var/lib/volition/project-browser/projects",
    ),
    projectBrowserPublicUrl: projectBrowserPublicUrl(env.PROJECT_BROWSER_PUBLIC_URL),
    projectBrowserDisplayBase: integerBase(
      env.PROJECT_BROWSER_DISPLAY_BASE,
      200,
      "PROJECT_BROWSER_DISPLAY_BASE",
    ),
    projectBrowserCdpPortBase: integerBase(
      env.PROJECT_BROWSER_CDP_PORT_BASE,
      19200,
      "PROJECT_BROWSER_CDP_PORT_BASE",
    ),
    projectBrowserVncPortBase: integerBase(
      env.PROJECT_BROWSER_VNC_PORT_BASE,
      15900,
      "PROJECT_BROWSER_VNC_PORT_BASE",
    ),
    projectBrowserNoVncPortBase: integerBase(
      env.PROJECT_BROWSER_NOVNC_PORT_BASE,
      16080,
      "PROJECT_BROWSER_NOVNC_PORT_BASE",
    ),
    projectBrowserSystemctlUser: env.PROJECT_BROWSER_SYSTEMCTL_SCOPE === "user",
    // Agent isolation (deployment/volition-stack/isolation): projects get Unix users of their
    // own and the browser state belongs to the browser user, both through the root launcher.
    agentIsolation: env.AGENT_ISOLATION === "on",
    agentLauncherSocket: absolutePath(
      env.VOLITION_LAUNCHER_SOCKET,
      "/run/volition-agent-launcher/launch.sock",
    ),
    systemctlBin: absolutePath(env.SYSTEMCTL_BIN, "/usr/bin/systemctl"),
    systemctlUser: env.SYSTEMCTL_SCOPE !== "system",
    mcookieBin: absolutePath(env.MCOOKIE_BIN, "/usr/bin/mcookie"),
    xauthBin: absolutePath(env.XAUTH_BIN, "/usr/bin/xauth"),
    inboxAccounts: mailAddresses(env.INBOX_TRIAGE_ACCOUNTS),
    inboxTriagePath: absolutePath(
      env.INBOX_TRIAGE_PATH,
      path.join(integrationStateRoot, "volition/inbox-triage.json"),
    ),
    inboxIntegrationTokenFile: absolutePath(
      env.INBOX_INTEGRATION_TOKEN_FILE,
      path.join(integrationStateRoot, "volition/inbox-integration-token"),
    ),
  };
}

export async function loadServerSecrets(config) {
  const token =
    config.token ||
    (config.provisioningTokenFile
      ? await privateSecret(config.provisioningTokenFile, "PROVISIONING_TOKEN_FILE")
      : "");
  const planApiKey =
    config.planApiKey ||
    (config.planApiKeyFile
      ? await privateCredential(config.planApiKeyFile, "ITSAPLAN_MCP_BEARER_FILE")
      : "");
  const planControlToken = config.planControlTokenFile
    ? await privateSecret(config.planControlTokenFile, "PLAN_CONTROL_TOKEN_FILE")
    : "";
  const connectionsIntegrationToken = config.connectionsEnabled
    ? await privateSecret(config.connectionsIntegrationTokenFile, "CONNECTIONS_INTEGRATION_TOKEN_FILE") : "";
  if (config.inboxAccounts.length === 0) {
    return { ...config, token, planApiKey, planControlToken, connectionsIntegrationToken };
  }
  const inboxIntegrationToken = await privateSecret(
    config.inboxIntegrationTokenFile,
    "INBOX_INTEGRATION_TOKEN_FILE",
  );
  return {
    ...config,
    token,
    planApiKey,
    planControlToken,
    inboxIntegrationToken,
    connectionsIntegrationToken,
  };
}

export function assertServerConfig(config) {
  if (Buffer.byteLength(config.token) < 32) {
    throw new Error("PROVISIONING_TOKEN must contain at least 32 bytes");
  }
  if (config.connectionsEnabled) {
    if (Buffer.byteLength(config.connectionsIntegrationToken || "") < 32) {
      throw new Error("CONNECTIONS_INTEGRATION_TOKEN must contain at least 32 bytes");
    }
  }
  if (
    config.inboxAccounts?.length &&
    Buffer.byteLength(config.inboxIntegrationToken || "") < 32
  ) {
    throw new Error("INBOX_INTEGRATION_TOKEN must contain at least 32 bytes");
  }
}
