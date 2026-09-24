import crypto from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  assertServerConfig,
  loadConfig,
  loadServerSecrets,
} from "./config.mjs";
import {
  createProvisioner,
  ProvisioningConflictError,
} from "./provisioner.mjs";
import {
  isUuid,
  RequestValidationError,
  validateEnvelope,
} from "./validation.mjs";
import { createTriageService, InboxValidationError } from "./triage.mjs";
import {
  createConnectionsService,
  ConnectionsValidationError,
} from "./connections.mjs";

const MAX_BODY_BYTES = 256 * 1024;

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function authorized(header, expected) {
  const supplied =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : "";
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  const expectedHash = crypto
    .createHash("sha256")
    .update(expected || "")
    .digest();
  return (
    crypto.timingSafeEqual(suppliedHash, expectedHash) && supplied.length > 0
  );
}

async function requestBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new RequestValidationError("The request body is too large", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestValidationError("The request body is not valid JSON");
  }
}

export function createRequestHandler(
  config,
  provisioner,
  triage = null,
  connections = null,
) {
  return async function handle(request, response) {
    if (request.method === "GET" && request.url === "/healthz") {
      json(response, 200, { ok: true });
      return;
    }
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const connectionList =
      request.method === "GET" && pathname === "/api/connections";
    const connectionAction =
      request.method === "POST" && pathname === "/api/connections/actions";
    if (connectionList || connectionAction) {
      if (!connections) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (
        !authorized(
          firstHeader(request.headers.authorization),
          config.connectionsIntegrationToken,
        )
      ) {
        response.setHeader("WWW-Authenticate", "Bearer");
        json(response, 401, { error: "unauthorized" });
        return;
      }
      if (
        request.method !== "GET" &&
        !firstHeader(request.headers["content-type"])
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        json(response, 415, { error: "json_required" });
        return;
      }
      try {
        if (connectionList) {
          json(response, 200, await connections.snapshot());
          return;
        }
        json(
          response,
          200,
          await connections.action(await requestBody(request)),
        );
      } catch (error) {
        if (error instanceof ConnectionsValidationError) {
          json(response, 400, {
            error: "invalid_request",
            message: error.message,
          });
        } else {
          json(response, error?.code === "unsupported_scope" ? 422 : 502, {
            error:
              error?.code === "unsupported_scope"
                ? "unsupported_scope"
                : "connector_failed",
            message: error?.message || "Connector request failed",
          });
        }
      }
      return;
    }
    const inboxTriage =
      request.method === "POST" && request.url === "/api/inbox/triage";
    const inboxTriageStatus =
      request.method === "GET" && request.url?.startsWith("/api/inbox/triage/");
    if (inboxTriage || inboxTriageStatus) {
      if (!triage) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (
        !authorized(
          firstHeader(request.headers.authorization),
          config.inboxIntegrationToken,
        )
      ) {
        response.setHeader("WWW-Authenticate", "Bearer");
        json(response, 401, { error: "unauthorized" });
        return;
      }
      if (
        !inboxTriageStatus &&
        !firstHeader(request.headers["content-type"])
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        json(response, 415, { error: "json_required" });
        return;
      }
      try {
        if (inboxTriageStatus) {
          let runId;
          try {
            runId = decodeURIComponent(
              request.url.slice("/api/inbox/triage/".length),
            );
          } catch {
            throw new InboxValidationError("The triage run id is invalid");
          }
          const status = await triage.status(runId);
          if (!status) json(response, 404, { error: "not_found" });
          else json(response, 200, status);
          return;
        }
        json(response, 202, await triage.start(await requestBody(request)));
      } catch (error) {
        if (
          error instanceof RequestValidationError ||
          error instanceof InboxValidationError
        ) {
          json(response, error.status ?? 400, {
            error: "invalid_request",
            message: error.message,
          });
        } else {
          json(response, 500, { error: "inbox_triage_failed" });
        }
      }
      return;
    }
    if (request.method === "GET" && pathname === "/api/provision/state") {
      if (!authorized(firstHeader(request.headers.authorization), config.token)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        json(response, 401, { error: "unauthorized" });
        return;
      }
      try {
        json(response, 200, await provisioner.state());
      } catch (error) {
        console.error("Reading the provisioning state failed", error);
        json(response, 500, { error: "state_failed" });
      }
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/provision") {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (!authorized(firstHeader(request.headers.authorization), config.token)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      json(response, 401, { error: "unauthorized" });
      return;
    }
    if (
      !firstHeader(request.headers["content-type"])
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      json(response, 415, { error: "json_required" });
      return;
    }
    const idempotencyKey = firstHeader(request.headers["idempotency-key"]);
    if (!isUuid(idempotencyKey)) {
      json(response, 400, {
        error: "invalid_request",
        message: "Idempotency-Key is invalid",
      });
      return;
    }

    try {
      const body = await requestBody(request);
      const envelope = validateEnvelope(body, {
        idempotencyKey,
        eventType: firstHeader(request.headers["x-itsaplan-event"]),
        eventId: firstHeader(request.headers["x-itsaplan-event-id"]),
      });
      json(
        response,
        200,
        envelope.eventType === "project.deprovision"
          ? await provisioner.deprovision(envelope)
          : await provisioner.provision(envelope),
      );
    } catch (error) {
      if (error instanceof RequestValidationError) {
        json(response, error.status, {
          error: "invalid_request",
          message: error.message,
        });
        return;
      }
      if (error instanceof ProvisioningConflictError) {
        json(response, 409, { error: "provisioning_conflict" });
        return;
      }
      console.error("Provisioning request failed", error);
      json(response, 500, { error: "provisioning_failed" });
    }
  };
}

export function createProvisioningServer(config, options = {}) {
  assertServerConfig(config);
  const provisioner = options.provisioner ?? createProvisioner(config, options);
  const triage =
    options.triage ??
    (config.inboxAccounts?.length
      ? createTriageService(config, options)
      : null);
  const connections =
    options.connections ??
    (config.connectionsEnabled
      ? createConnectionsService(config)
      : null);
  const handler = createRequestHandler(config, provisioner, triage, connections);
  const server = http.createServer(handler);
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const config = await loadServerSecrets(loadConfig());
  const server = createProvisioningServer(config);
  server.listen(config.port, config.host, () => {
    console.log(
      `Volition provisioning service listening on ${config.host}:${config.port}`,
    );
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
