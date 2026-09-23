export class ConnectionsValidationError extends Error {}

function service(ok, checkedAt, error = null) {
  return {
    status: ok ? "connected" : "error",
    connected: ok,
    running: ok,
    lastCheckedAt: checkedAt,
    lastSuccessAt: ok ? checkedAt : null,
    lastError: error ? String(error).slice(0, 500) : null,
  };
}

function item(id, label, values) {
  return {
    id: "service:" + id,
    kind: "service",
    provider: id,
    label,
    configured: true,
    canProbe: true,
    canReconnect: false,
    canPair: false,
    manageUrl: null,
    ...values,
  };
}

export function createConnectionsService(config, options = {}) {
  const request = options.fetch ?? fetch;

  async function probeHttp(id, label, baseUrl, pathName, statuses) {
    const checkedAt = new Date().toISOString();
    if (!baseUrl) return item(id, label, service(false, checkedAt, "Service is not configured"));
    try {
      const response = await request(new URL(pathName, baseUrl), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
      });
      const ok = statuses.includes(response.status);
      return item(id, label, service(ok, checkedAt, ok ? null : "HTTP " + response.status));
    } catch {
      return item(id, label, service(false, checkedAt, "Service probe failed"));
    }
  }

  async function hermes() {
    const checkedAt = new Date().toISOString();
    const home = config.hermesHome;
    const configured = typeof home === "string" && home.length > 0;
    return {
      id: "service:hermes",
      kind: "service",
      provider: "hermes",
      label: "Hermes",
      configured,
      canProbe: true,
      canReconnect: false,
      canPair: false,
      manageUrl: null,
      ...service(configured, checkedAt, configured ? null : "Hermes is not configured"),
    };
  }

  async function snapshot() {
    const items = await Promise.all([
      hermes(),
      probeHttp("nextcloud", "Nextcloud", config.nextcloudInternalUrl, "/status.php", [200]),
    ]);
    return { checkedAt: new Date().toISOString(), items };
  }

  async function action(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.id !== "string" || typeof input.action !== "string") {
      throw new ConnectionsValidationError("Action input is invalid");
    }
    if (input.action !== "probe" || (input.id !== "all" && !/^service:(hermes|nextcloud)$/.test(input.id))) {
      throw new ConnectionsValidationError("This connection action is not allowed");
    }
    return snapshot();
  }

  return { snapshot, action, stop() {} };
}
