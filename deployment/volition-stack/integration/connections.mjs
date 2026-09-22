import { GatewayClient } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export class ConnectionsValidationError extends Error {}

function safeText(value, maximum = 500) {
  return typeof value === "string" ? value.slice(0, maximum) : null;
}

function statusOf(account) {
  if (account.connected) return "connected";
  if (account.running || account.configured) return account.lastError ? "error" : "available";
  return account.enabled === false ? "disabled" : "unavailable";
}

function publicChannel(channel, label, account, manageUrl) {
  return {
    id: `channel:${channel}:${account.accountId}`,
    kind: "channel",
    provider: channel,
    label: account.name || label || channel,
    accountId: account.accountId,
    status: statusOf(account),
    configured: account.configured === true,
    connected: account.connected === true,
    running: account.running === true,
    lastCheckedAt: account.lastProbeAt ? new Date(account.lastProbeAt).toISOString() : null,
    lastSuccessAt: account.lastConnectedAt ? new Date(account.lastConnectedAt).toISOString() : null,
    lastError: safeText(account.lastError),
    canProbe: true,
    canReconnect: account.configured === true,
    canPair: channel === "whatsapp" && account.linked !== true,
    manageUrl: manageUrl || null,
  };
}

function publicMcp(value, probe) {
  const name = value.name;
  return {
    id: `mcp:${name}`,
    kind: "mcp",
    provider: name,
    label: name,
    status: value.enabled === false ? "disabled" : probe ? (probe.ok ? "connected" : "error") : value.ok === false ? "error" : "configured",
    configured: value.configured === true,
    connected: probe?.ok === true,
    running: value.enabled !== false,
    lastCheckedAt: probe?.checkedAt ?? null,
    lastSuccessAt: probe?.ok ? probe.checkedAt : null,
    lastError: probe?.error ?? (value.ok === false ? "OpenClaw reports an invalid MCP configuration" : null),
    canProbe: true,
    canReconnect: value.enabled !== false,
    canPair: false,
    toolCount: probe?.toolCount,
  };
}

function serviceStatus(ok, checkedAt, error = null) {
  return {
    status: ok ? "connected" : "error",
    connected: ok,
    running: ok,
    lastCheckedAt: checkedAt,
    lastSuccessAt: ok ? checkedAt : null,
    lastError: error ? String(error).slice(0, 500) : null,
  };
}

export function checkedMcpProbe(value, name) {
  // OpenClaw can exit 0 while reporting startup failures in diagnostics.
  // A connected named server, its tools, and the absence of diagnostics are
  // required; process success alone is not evidence of a working integration.
  const server = value?.servers && !Array.isArray(value.servers) ? value.servers[name] : null;
  const tools = value?.tools && typeof value.tools === "object" ? Object.keys(value.tools).length : -1;
  if (!server || !Number.isInteger(server.tools) || server.tools < 0 ||
      tools < server.tools || !Array.isArray(value.diagnostics) ||
      value.diagnostics.length > 0) {
    throw new Error("Native MCP probe did not confirm the requested server");
  }
  return server.tools;
}

export function createConnectionsService(config, options = {}) {
  const createClient = options.createClient ?? ((clientOptions) => new GatewayClient(clientOptions));
  const request = options.fetch ?? fetch;
  const execute = options.execute ?? execFileAsync;
  const mcpProbes = new Map();
  let client;
  let connected = false;
  let connecting;

  async function gateway() {
    if (connected && client) return client;
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      let timer;
      client = createClient({
        url: config.openClawGatewayUrl,
        password: config.openClawGatewayPassword,
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        clientName: "gateway-client",
        clientDisplayName: "Volition connections integration",
        mode: "backend",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        onHelloOk: () => {
          clearTimeout(timer);
          connected = true;
          connecting = undefined;
          resolve(client);
        },
        onConnectError: () => {
          clearTimeout(timer);
          connected = false;
          connecting = undefined;
          reject(new Error("OpenClaw Gateway connection failed"));
        },
        onClose: () => {
          connected = false;
        },
      });
      timer = setTimeout(() => {
        connected = false;
        connecting = undefined;
        client?.stop();
        client = undefined;
        reject(new Error("OpenClaw Gateway connection timed out"));
      }, CONNECT_TIMEOUT_MS);
      client.start();
    });
    return connecting;
  }

  async function rpc(method, params) {
    const active = await gateway();
    return active.request(method, params, { timeoutMs: REQUEST_TIMEOUT_MS });
  }

  async function openClaw(args) {
    const result = await execute(config.openClawBin, args, {
      shell: false,
      timeout: 75_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.dirname(config.openClawRoot),
        PATH: `${path.dirname(config.openClawBin)}:/usr/local/bin:/usr/bin:/bin`,
      },
    });
    return JSON.parse(result.stdout);
  }

  async function mcpStatus() {
    const value = await openClaw(["mcp", "status", "--json"]);
    return Array.isArray(value?.servers) ? value.servers : [];
  }

  async function probeMcp(name) {
    const checkedAt = new Date().toISOString();
    try {
      const result = await openClaw(["mcp", "probe", name, "--json"]);
      const record = { ok: true, checkedAt, error: null, toolCount: checkedMcpProbe(result, name) };
      mcpProbes.set(name, record);
      return record;
    } catch {
      const record = { ok: false, checkedAt, error: "MCP probe failed", toolCount: undefined };
      mcpProbes.set(name, record);
      return record;
    }
  }

  async function probeHttp(id, baseUrl, pathName, acceptedStatuses) {
    const checkedAt = new Date().toISOString();
    try {
      const target = new URL(pathName, baseUrl);
      const response = await request(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
      });
      const ok = acceptedStatuses.includes(response.status);
      return {
        id: `service:${id}`,
        kind: "service",
        provider: id,
        label: id === "nextcloud" ? "Nextcloud" : id,
        configured: true,
        canProbe: true,
        canReconnect: false,
        canPair: false,
        ...serviceStatus(ok, checkedAt, ok ? null : `HTTP ${response.status}`),
      };
    } catch {
      return {
        id: `service:${id}`,
        kind: "service",
        provider: id,
        label: id === "nextcloud" ? "Nextcloud" : id,
        configured: true,
        canProbe: true,
        canReconnect: false,
        canPair: false,
        ...serviceStatus(false, checkedAt, "Service probe failed"),
      };
    }
  }

  async function snapshot({ probe = false } = {}) {
    const [channelResult, servers, nextcloud, artifactStatus] = await Promise.all([
      rpc("channels.status", { probe, timeoutMs: probe ? 8_000 : 0 }),
      mcpStatus(),
      probeHttp("nextcloud", config.nextcloudInternalUrl, "/status.php", [200]),
      options.artifactSync?.status().catch(() => ({ running: false, projects: {}, statusError: "Archive status could not be read" })) ?? null,
    ]);
    if (probe) await Promise.all(servers.filter((server) => server?.enabled !== false).map((server) => probeMcp(server.name)));
    const items = [];
    for (const [channel, accounts] of Object.entries(channelResult?.channelAccounts ?? {})) {
      for (const account of accounts ?? []) {
        items.push(publicChannel(channel, channelResult?.channelLabels?.[channel], account, config.openClawUrl));
      }
    }
    for (const value of servers) {
      if (typeof value?.name === "string" && SAFE_ID.test(value.name)) items.push(publicMcp(value, mcpProbes.get(value.name)));
    }
    items.push({
      id: "service:openclaw",
      kind: "service",
      provider: "openclaw",
      label: "OpenClaw",
      configured: true,
      canProbe: true,
      canReconnect: false,
      canPair: false,
      manageUrl: config.openClawUrl || null,
      ...serviceStatus(true, new Date().toISOString()),
    }, nextcloud);
    if (artifactStatus) {
      const projects = Object.values(artifactStatus.projects ?? {});
      const lastError = artifactStatus.statusError ?? projects.find((project) => project.lastError)?.lastError ?? null;
      const lastSuccessAt = projects
        .map((project) => project.lastSuccessAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      const lastCheckedAt = projects
        .flatMap((project) => [project.lastSuccessAt, project.lastDryRunAt])
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      items.push({
        id: "service:artifact-sync",
        kind: "service",
        provider: "artifact-sync",
        label: "Document archive",
        configured: true,
        connected: !lastError && Boolean(lastSuccessAt),
        running: artifactStatus.running === true,
        status: lastError ? "error" : lastSuccessAt ? "connected" : "configured",
        lastCheckedAt,
        lastSuccessAt,
        lastError,
        canProbe: false,
        canReconnect: false,
        canPair: false,
      });
    }
    if (!items.some((item) => item.kind === "channel" && item.provider === "whatsapp")) {
      items.push({
        id: "channel:whatsapp:default",
        kind: "channel",
        provider: "whatsapp",
        label: "WhatsApp",
        accountId: "default",
        status: "unavailable",
        configured: false,
        connected: false,
        running: false,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
        lastError: "WhatsApp is not configured in OpenClaw",
        canProbe: false,
        canReconnect: false,
        canPair: false,
        manageUrl: config.openClawUrl || null,
      });
    }
    return { checkedAt: new Date().toISOString(), items };
  }

  async function action(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ConnectionsValidationError("Action input is invalid");
    }
    const { id, action: requested } = input;
    if (typeof id !== "string" || id.length > 300 || typeof requested !== "string") {
      throw new ConnectionsValidationError("Action input is invalid");
    }
    if (requested === "probe") {
      const mcp = /^mcp:([a-z0-9._-]+)$/i.exec(id);
      if (mcp) await probeMcp(mcp[1]);
      return snapshot({ probe: id === "all" });
    }
    const mcp = /^mcp:([a-z0-9._-]+)$/i.exec(id);
    if (mcp && requested === "reconnect") {
      await openClaw(["mcp", "reload"]);
      await probeMcp(mcp[1]);
      return snapshot();
    }
    const match = /^channel:([^:]+):([^:]+)$/.exec(id);
    if (!match || requested !== "reconnect" || !SAFE_ID.test(match[1]) || !SAFE_ID.test(match[2])) {
      throw new ConnectionsValidationError("This connection action is not allowed");
    }
    const [, channel, accountId] = match;
    await rpc("channels.stop", { channel, accountId });
    await rpc("channels.start", { channel, accountId });
    return snapshot({ probe: true });
  }

  return {
    snapshot,
    action,
    async setTheme(theme) {
      const result = await rpc("users.prefs.set", { entries: { "ui.themeMode": theme } });
      if (result?.status !== "ok" && result?.status !== "no_durable_identity") {
        throw new Error("OpenClaw rejected the theme update");
      }
    },
    stop() {
      client?.stop();
      client = undefined;
      connected = false;
      connecting = undefined;
    },
  };
}
