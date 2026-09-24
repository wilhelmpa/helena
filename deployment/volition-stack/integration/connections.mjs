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

export function createConnectionsService(config) {
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
    const items = [await hermes()];
    return { checkedAt: new Date().toISOString(), items };
  }

  async function action(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.id !== "string" || typeof input.action !== "string") {
      throw new ConnectionsValidationError("Action input is invalid");
    }
    if (input.action !== "probe" || (input.id !== "all" && input.id !== "service:hermes")) {
      throw new ConnectionsValidationError("This connection action is not allowed");
    }
    return snapshot();
  }

  return { snapshot, action, stop() {} };
}
