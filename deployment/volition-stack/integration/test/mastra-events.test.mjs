import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { createMastraEventService, MastraEventError } from "../mastra-events.mjs";
import { createRequestHandler } from "../server.mjs";

const TOKEN = "control-token-0123456789abcdef0123456789";
const ADAPTER_TOKEN = "adapter-token-0123456789abcdef0123456789";
const input = {
  eventId: "event-001",
  eventType: "system.audit.requested",
  organizationRef: "organization:volition",
  projectRef: "project:PRIV",
  capabilityRefs: [],
  connectionRefs: [],
  payload: { projectKey: "PRIV", mode: "shadow" },
  dryRun: true,
};
const result = {
  eventId: "event-001",
  eventType: "system.audit.requested",
  workflowId: "system-audit",
  projectRef: "project:PRIV",
  runId: "event-001",
  status: "success",
  replayed: false,
};
let server;

afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  server = null;
});

test("hub adapter forwards only the private bearer and validates the response", async () => {
  let call;
  const service = createMastraEventService(
    {
      mastraEventUrl: "http://172.30.95.2:4111/internal/events",
      mastraEventToken: ADAPTER_TOKEN,
    },
    {
      fetch: async (url, init) => {
        call = { url: String(url), init };
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.deepEqual(await service.emit(input), result);
  assert.equal(call.url, "http://172.30.95.2:4111/internal/events");
  assert.equal(call.init.headers.authorization, "Bearer " + ADAPTER_TOKEN);
  assert.deepEqual(JSON.parse(call.init.body), input);
  assert.equal("x-auth-request-email" in call.init.headers, false);
});

test("hub adapter preserves safe contract errors and hides upstream failures", async () => {
  const rejected = createMastraEventService(
    {
      mastraEventUrl: "http://172.30.95.2:4111/internal/events",
      mastraEventToken: ADAPTER_TOKEN,
    },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "project_scope_mismatch",
            message: "payload.projectKey does not match projectRef",
          }),
          { status: 409 },
        ),
    },
  );
  await assert.rejects(
    () => rejected.emit(input),
    value =>
      value instanceof MastraEventError &&
      value.status === 409 &&
      value.code === "project_scope_mismatch",
  );

  const failed = createMastraEventService(
    {
      mastraEventUrl: "http://172.30.95.2:4111/internal/events",
      mastraEventToken: ADAPTER_TOKEN,
    },
    { fetch: async () => new Response("upstream detail", { status: 500 }) },
  );
  await assert.rejects(
    () => failed.emit(input),
    value =>
      value instanceof MastraEventError &&
      value.status === 502 &&
      value.code === "event_ingress_failed",
  );
});

test("hub event route is private, JSON-only and delegates without reshaping the contract", async () => {
  const handler = createRequestHandler(
    { mastraControlToken: TOKEN },
    {},
    null,
    null,
    null,
    null,
    null,
    null,
    { emit: async value => ({ ...result, replayed: value.eventId === "replay" }) },
  );
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;

  assert.equal(
    (
      await fetch(origin + "/internal/mastra/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(origin + "/internal/mastra/events", {
        method: "POST",
        headers: { authorization: "Bearer " + TOKEN },
        body: JSON.stringify(input),
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(origin + "/internal/mastra/events", {
        method: "POST",
        headers: {
          authorization: "Bearer " + TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...input, payload: { value: "x".repeat(70 * 1024) } }),
      })
    ).status,
    413,
  );
  const response = await fetch(origin + "/internal/mastra/events", {
    method: "POST",
    headers: {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});
