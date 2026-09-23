import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
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
import { createInboxService, InboxValidationError } from "./inbox.mjs";
import { createTriageService } from "./triage.mjs";
import {
  createConnectionsService,
  ConnectionsValidationError,
} from "./connections.mjs";
import { createMailService, MailValidationError } from "./mail-service.mjs";
import {
  createMastraControlService,
  MastraControlError,
} from "./mastra-control.mjs";
import {
  createMastraEventService,
  MastraEventError,
} from "./mastra-events.mjs";

import {
  createSecretStore,
  SecretStoreValidationError,
} from "./secret-store.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_BODY_BYTES = 64 * 1024;

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

function noContent(response) {
  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

function attachment(response, value) {
  const filename = String(value.filename || "attachment").replace(
    /[\r\n"\\]/g,
    "_",
  );
  response.writeHead(200, {
    "Content-Type": value.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": value.bytes.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(value.bytes);
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
  inbox = null,
  triage = null,
  connections = null,
  mail = null,
  secrets = null,
  mastraControl = null,
  mastraEvents = null,
) {
  return async function handle(request, response) {
    if (request.method === "GET" && request.url === "/healthz") {
      json(response, 200, { ok: true });
      return;
    }
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const mastraControlRoute =
      request.method === "POST" && pathname === "/internal/mastra/control";
    if (mastraControlRoute) {
      if (!mastraControl || !config.mastraControlToken) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (
        !authorized(
          firstHeader(request.headers.authorization),
          config.mastraControlToken,
        )
      ) {
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
      try {
        json(
          response,
          200,
          await mastraControl.execute(await requestBody(request)),
        );
      } catch (error) {
        if (
          error instanceof RequestValidationError ||
          error instanceof MastraControlError
        ) {
          json(response, error.status ?? 400, {
            error: "control_request_failed",
            message: error.message,
          });
        } else {
          json(response, 502, { error: "control_plane_failed" });
        }
      }
      return;
    }
    const mastraEventRoute =
      request.method === "POST" && pathname === "/internal/mastra/events";
    if (mastraEventRoute) {
      if (!mastraEvents || !config.mastraControlToken) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (
        !authorized(
          firstHeader(request.headers.authorization),
          config.mastraControlToken,
        )
      ) {
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
      try {
        json(
          response,
          200,
          await mastraEvents.emit(await requestBody(request, MAX_EVENT_BODY_BYTES)),
        );
      } catch (error) {
        if (
          error instanceof RequestValidationError ||
          error instanceof MastraEventError
        ) {
          json(response, error.status ?? 400, {
            error: error.code ?? "invalid_event",
            message: error.message,
          });
        } else {
          json(response, 502, { error: "event_ingress_failed" });
        }
      }
      return;
    }
    const mastraClassifier =
      request.method === "POST" &&
      pathname === "/internal/mastra/inbox/classify";
    if (mastraClassifier) {
      if (!triage || !config.mastraInboxToken) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (
        !authorized(
          firstHeader(request.headers.authorization),
          config.mastraInboxToken,
        )
      ) {
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
      try {
        const body = await requestBody(request);
        const keys =
          body && typeof body === "object" && !Array.isArray(body)
            ? Object.keys(body).sort().join(",")
            : "";
        if (
          keys !==
            "capability,context,correlationId,eventId,payload,schemaVersion" ||
          body.schemaVersion !== 1 ||
          body.capability !== config.mastraInboxCapabilityRef ||
          body.context?.organizationRef !== config.mastraInboxOrganizationRef ||
          body.context?.projectRef !== config.mastraInboxProjectRef ||
          !Array.isArray(body.context?.capabilityRefs) ||
          !body.context.capabilityRefs.includes(
            config.mastraInboxCapabilityRef,
          ) ||
          !Array.isArray(body.context?.connectionRefs) ||
          !isUuid(body.eventId) ||
          body.correlationId !== body.payload?.thread?.id
        ) {
          throw new InboxValidationError("The classifier request is invalid");
        }
        json(response, 200, {
          result: await triage.classify(body.payload, body.eventId),
        });
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
          json(response, 502, { error: "classifier_failed" });
        }
      }
      return;
    }
    const connectionList =
      request.method === "GET" && pathname === "/api/connections";
    const connectionAction =
      request.method === "POST" && pathname === "/api/connections/actions";
    const secretList = request.method === "GET" && pathname === "/api/secrets";
    const secretSet = request.method === "POST" && pathname === "/api/secrets";
    const secretRoute = secretList || secretSet;
    const mailRoute = pathname.startsWith("/api/mail/");
    if (connectionList || connectionAction || mailRoute || secretRoute) {
      if (
        (!secrets && secretRoute) ||
        (!connections && (connectionList || connectionAction)) ||
        (!mail && mailRoute)
      ) {
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
        if (secretList) {
          json(response, 200, await secrets.list());
          return;
        }
        if (secretSet) {
          json(response, 200, await secrets.set(await requestBody(request)));
          return;
        }
        if (connectionList) {
          json(response, 200, await connections.snapshot());
          return;
        }
        if (connectionAction) {
          json(
            response,
            200,
            await connections.action(await requestBody(request)),
          );
          return;
        }
        const body = request.method === "GET" ? {} : await requestBody(request);
        const routes = new Map([
          ["POST /api/mail/accounts", () => mail.accountsStatus()],
          ["POST /api/mail/search", () => mail.search(body)],
          ["POST /api/mail/thread", () => mail.getThread(body)],
          ["POST /api/mail/labels", () => mail.labels(body)],
          ["POST /api/mail/labels/modify", () => mail.modifyLabels(body)],
          ["POST /api/mail/drafts", () => mail.createDraft(body)],
          ["POST /api/mail/drafts/list", () => mail.listDrafts(body)],
          [
            "POST /api/mail/drafts/authorize-send",
            () => mail.authorizeSend(body),
          ],
          ["POST /api/mail/drafts/send", () => mail.sendDraft(body)],
          ["POST /api/mail/attachment", () => mail.attachment(body)],
        ]);
        const operation = routes.get(`${request.method} ${pathname}`);
        if (!operation) {
          json(response, 404, { error: "not_found" });
          return;
        }
        const result = await operation();
        if (pathname === "/api/mail/attachment") attachment(response, result);
        else json(response, 200, result);
      } catch (error) {
        if (secretRoute && !(error instanceof SecretStoreValidationError)) {
          json(response, 502, {
            error: "secret_store_failed",
            message: "Native secret store operation failed",
          });
        } else if (
          error instanceof SecretStoreValidationError ||
          error instanceof ConnectionsValidationError ||
          error instanceof MailValidationError
        ) {
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
    const inboxPush =
      request.method === "POST" && request.url === "/inbox/gmail/push";
    const inboxSync =
      request.method === "POST" && request.url === "/api/inbox/sync";
    const inboxTriage =
      request.method === "POST" && request.url === "/api/inbox/triage";
    const inboxTriageStatus =
      request.method === "GET" && request.url?.startsWith("/api/inbox/triage/");
    if (inboxPush || inboxSync || inboxTriage || inboxTriageStatus) {
      if (
        ((inboxPush || inboxSync) && !inbox) ||
        ((inboxTriage || inboxTriageStatus) && !triage)
      ) {
        json(response, 404, { error: "not_found" });
        return;
      }
      const expectedToken = inboxPush
        ? config.inboxPushToken
        : config.inboxIntegrationToken;
      if (
        !authorized(firstHeader(request.headers.authorization), expectedToken)
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
        const body = await requestBody(request);
        if (inboxPush) {
          await inbox.recordPush(body);
          noContent(response);
        } else if (inboxTriage) {
          json(response, 202, await triage.start(body));
        } else {
          json(response, 200, await inbox.sync(body));
        }
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
          json(response, inboxPush ? 503 : 500, {
            error: inboxPush ? "push_not_persisted" : "inbox_sync_failed",
          });
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
  const mastraControl =
    options.mastraControl ??
    (config.mastraControlEnabled
      ? createMastraControlService(config, options)
      : null);
  const provisioner =
    options.provisioner ?? createProvisioner(config, { ...options, mastraControl });
  const inbox =
    options.inbox ??
    (config.inboxAccounts?.length ? createInboxService(config, options) : null);
  const triage =
    options.triage ??
    (config.inboxAccounts?.length
      ? createTriageService(config, options)
      : null);
  const connections =
    options.connections ??
    (config.connectionsEnabled
      ? createConnectionsService(config, options)
      : null);
  const mail =
    options.mail ??
    (config.inboxAccounts?.length && config.mailEnabled
      ? createMailService(config, options)
      : null);
  const secrets =
    options.secrets ??
    (config.connectionsEnabled ? createSecretStore(config, options) : null);
  const mastraEvents =
    options.mastraEvents ??
    (config.mastraEventIngressEnabled && config.mastraEventToken
      ? createMastraEventService(config, options)
      : null);
  const handler = createRequestHandler(
    config,
    provisioner,
    inbox,
    triage,
    connections,
    mail,
    secrets,
    mastraControl,
    mastraEvents,
  );
  const server = http.createServer(handler);
  server.mastraClassifierServer = http.createServer(handler);
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
  if (config.mastraInboxToken) {
    const socketPath = config.mastraInboxClassifierSocketPath;
    await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    try {
      const stat = await fs.lstat(socketPath);
      if (!stat.isSocket())
        throw new Error("The Mastra classifier socket path is not a socket");
      await fs.unlink(socketPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve, reject) => {
      server.mastraClassifierServer.once("error", reject);
      server.mastraClassifierServer.listen(socketPath, resolve);
    });
    await fs.chmod(socketPath, 0o600);
  }
  server.listen(config.port, config.host, () => {
    console.log(
      `Volition provisioning service listening on ${config.host}:${config.port}`,
    );
  });
  const shutdown = () => {
    server.mastraClassifierServer.close(() => undefined);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
